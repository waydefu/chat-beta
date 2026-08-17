import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error - plain ESM helper shared with scripts/, no types to import.
import { describeMissing, extractCollectionGroupQueries, missingIndexes } from '../scripts/index-contract.mjs';

interface CollectionGroupQuery {
  file: string;
  collectionGroup: string;
  line: number;
  equality: string[];
  range: string[];
  orderBy: string[];
}

interface MissingIndex {
  query: CollectionGroupQuery;
  fields: string[];
  kind: 'single-field' | 'composite';
  remedy: string;
}

const extract = extractCollectionGroupQueries as (source: string, file?: string) => CollectionGroupQuery[];
const missing = missingIndexes as (queries: CollectionGroupQuery[], indexes: unknown) => MissingIndex[];
const describe_ = describeMissing as (entry: MissingIndex) => string;

const root = join(import.meta.dirname, '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function repositoryQueries(): CollectionGroupQuery[] {
  return [join(root, 'functions', 'src'), join(root, 'src')]
    .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    .flatMap((dir) => sources(dir))
    .flatMap((file) => extract(readFileSync(file, 'utf8'), relative(root, file).split(sep).join('/')));
}

const declaredIndexes = JSON.parse(readFileSync(join(root, 'firestore.indexes.json'), 'utf8'));

describe('Firestore collection-group index contract', () => {
  it('declares an index for every collection-group query in the repository', () => {
    const queries = repositoryQueries();
    // A silent zero would make this suite pass by finding nothing at all.
    expect(queries.length).toBeGreaterThan(0);
    expect(missing(queries, declaredIndexes).map(describe_)).toEqual([]);
  });

  it('covers the signal cleanup query that failed in production', () => {
    // `cleanupExpiredCallSignals` failed every scheduled run with
    // FAILED_PRECONDITION until the fieldOverride below existed. If the
    // extractor ever stops seeing this query the suite above goes quiet, so the
    // one that actually broke is asserted by name.
    const cleanup = repositoryQueries().find((query) => (
      query.collectionGroup === 'incomingCalls' && query.range.includes('expiresAt')
    ));
    expect(cleanup).toBeDefined();
    expect(missing([cleanup!], declaredIndexes)).toEqual([]);
  });
});

describe('collection-group query extraction', () => {
  it('separates equality filters, range filters and explicit ordering', () => {
    const [query] = extract(`
      const expired = await firestore.collectionGroup('attachments')
        .where('status', '==', 'quarantined')
        .where('expiresAt', '<=', new Date())
        .limit(100)
        .get();
    `);
    expect(query?.collectionGroup).toBe('attachments');
    expect(query?.equality).toEqual(['status']);
    expect(query?.range).toEqual(['expiresAt']);
    expect(query?.orderBy).toEqual([]);
  });

  it('ignores the document-id ordering Firestore appends anyway', () => {
    const [query] = extract(`
      let query = firestore.collectionGroup('incomingCalls')
        .where('roomId', '==', roomId)
        .where('callId', '==', callId)
        .orderBy(FieldPath.documentId())
        .limit(WRITE_BATCH_SIZE);
    `);
    expect(query?.orderBy).toEqual([]);
    expect(query?.equality).toEqual(['roomId', 'callId']);
  });

  it('follows a chain that continues into a later statement', () => {
    const [query] = extract(`
      let query = firestore.collectionGroup('calls').where('status', '==', 'active');
      if (cursor) query = query.startAfter(cursor);
    `);
    // The `.where` before the semicolon belongs to the query; the reassignment
    // after it must not be swallowed into the same requirement.
    expect(query?.equality).toEqual(['status']);
    expect(extract("firestore.collectionGroup('calls').where('status', '==', 'a');")).toHaveLength(1);
  });

  it('keeps two queries in one Promise.all apart', () => {
    // Both halves of `cleanupStaleLiveKitCalls` are collectionGroup('calls').
    // Merging them would demand an index for a query nobody wrote.
    const found = extract(`
      const [stale, legacy] = await Promise.all([
        firestore.collectionGroup('calls').where('status', 'in', live).where('leaseExpiresAt', '<=', now).get(),
        firestore.collectionGroup('calls').where('status', '==', 'active').where('startedAt', '<=', cutoff).get(),
      ]);
    `);
    expect(found.map((query) => query.range)).toEqual([['leaseExpiresAt'], ['startedAt']]);
  });

  it('follows filters a later statement adds to the same query variable', () => {
    // Under-reporting is the one failure this checker must not have: a filter
    // it cannot see is an index it will not ask for.
    const [query] = extract(`
      let query = firestore.collectionGroup('calls');
      query = query.where('status', '==', 'active');
      query = query.orderBy('startedAt');
    `);
    expect(query?.equality).toEqual(['status']);
    expect(query?.orderBy).toEqual(['startedAt']);
  });

  it('finds every query in a file rather than only the first', () => {
    const found = extract(`
      firestore.collectionGroup('a').where('x', '==', 1).get();
      firestore.collectionGroup('b').where('y', '<=', 2).get();
    `);
    expect(found.map((query) => query.collectionGroup)).toEqual(['a', 'b']);
  });

  it('treats an unrecognised operator as a range constraint rather than dropping it', () => {
    const [query] = extract("firestore.collectionGroup('a').where('x', 'weird-op', 1).get();");
    expect(query?.range).toEqual(['x']);
  });
});

describe('index requirement checking', () => {
  const singleFieldQuery = extract("firestore.collectionGroup('incomingCalls').where('expiresAt', '<=', now).get();");
  const compositeQuery = extract(`
    firestore.collectionGroup('calls').where('status', '==', 'active').where('startedAt', '<=', now).get();
  `);

  it('accepts an unfiltered collection-group read without any declared index', () => {
    const [query] = extract("await firestore.collectionGroup('members').get();");
    expect(missing([query!], { indexes: [], fieldOverrides: [] })).toEqual([]);
  });

  it('rejects a single-field collection-group query with no fieldOverride', () => {
    const result = missing(singleFieldQuery, { indexes: [], fieldOverrides: [] });
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('single-field');
    expect(describe_(result[0]!)).toContain('fieldOverrides');
  });

  it('rejects a fieldOverride that only declares COLLECTION scope', () => {
    // The exact production failure: Firestore creates these two automatically,
    // and they do not serve a collection-group query.
    const result = missing(singleFieldQuery, {
      indexes: [],
      fieldOverrides: [{
        collectionGroup: 'incomingCalls',
        fieldPath: 'expiresAt',
        indexes: [
          { order: 'ASCENDING', queryScope: 'COLLECTION' },
          { order: 'DESCENDING', queryScope: 'COLLECTION' },
        ],
      }],
    });
    expect(result).toHaveLength(1);
  });

  it('accepts a fieldOverride that declares COLLECTION_GROUP scope', () => {
    expect(missing(singleFieldQuery, {
      indexes: [],
      fieldOverrides: [{
        collectionGroup: 'incomingCalls',
        fieldPath: 'expiresAt',
        indexes: [{ order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' }],
      }],
    })).toEqual([]);
  });

  it('rejects a fieldOverride declared on a different collection or field', () => {
    const wrongCollection = missing(singleFieldQuery, {
      indexes: [],
      fieldOverrides: [{
        collectionGroup: 'calls',
        fieldPath: 'expiresAt',
        indexes: [{ order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' }],
      }],
    });
    const wrongField = missing(singleFieldQuery, {
      indexes: [],
      fieldOverrides: [{
        collectionGroup: 'incomingCalls',
        fieldPath: 'createdAt',
        indexes: [{ order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' }],
      }],
    });
    expect(wrongCollection).toHaveLength(1);
    expect(wrongField).toHaveLength(1);
  });

  it('rejects a composite query whose declared index is missing a field', () => {
    const result = missing(compositeQuery, {
      indexes: [{
        collectionGroup: 'calls',
        queryScope: 'COLLECTION_GROUP',
        fields: [{ fieldPath: 'status', order: 'ASCENDING' }],
      }],
      fieldOverrides: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('composite');
  });

  it('rejects a composite index declared at COLLECTION scope', () => {
    expect(missing(compositeQuery, {
      indexes: [{
        collectionGroup: 'calls',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'startedAt', order: 'ASCENDING' },
        ],
      }],
      fieldOverrides: [],
    })).toHaveLength(1);
  });

  it('accepts a composite query whose COLLECTION_GROUP index covers every field', () => {
    expect(missing(compositeQuery, {
      indexes: [{
        collectionGroup: 'calls',
        queryScope: 'COLLECTION_GROUP',
        fields: [
          { fieldPath: 'status', order: 'ASCENDING' },
          { fieldPath: 'startedAt', order: 'ASCENDING' },
        ],
      }],
      fieldOverrides: [],
    })).toEqual([]);
  });
});
