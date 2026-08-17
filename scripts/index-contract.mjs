/**
 * Firestore collection-group index contract.
 *
 * `cleanupExpiredCallSignals` ran for days doing nothing: every scheduled
 * invocation failed with FAILED_PRECONDITION because
 * `collectionGroup('incomingCalls').where('expiresAt','<=',…)` is a
 * single-field collection-group query, and Firestore only auto-creates
 * single-field indexes at COLLECTION scope. Nothing in the repository could
 * tell: the query lives in TypeScript, the index contract lives in JSON, and
 * neither file knows the other exists. `pnpm check` was green the whole time.
 *
 * So the contract is derived rather than remembered. The extractor reads the
 * actual `collectionGroup(...)` chains out of the source and asks whether
 * `firestore.indexes.json` can serve each one. A new collection-group query
 * that ships without its index fails the unit gate, in the same commit that
 * introduced it.
 *
 * The extractor is deliberately syntactic — a regex chain walk, not a TypeScript
 * program. It is allowed to be conservative (report a requirement it cannot
 * fully resolve) but it must never silently drop a query, which is why an
 * unparseable filter argument still contributes its field name.
 */

/** Operators that Firestore serves from the equality part of an index. */
const EQUALITY_OPERATORS = new Set(['==', 'in', 'array-contains', 'array-contains-any']);

/** Everything else narrows a range and has to be the last indexed field. */
const RANGE_OPERATORS = new Set(['<', '<=', '>', '>=', '!=', 'not-in']);

/**
 * `orderBy(FieldPath.documentId())` and `orderBy('__name__')` ride on the index
 * Firestore always appends, so they add no requirement of their own.
 */
const DOCUMENT_ID_ORDER = /^(?:FieldPath\.documentId\(\)|['"`]__name__['"`])$/;

/**
 * Walks the chained calls that follow a `collectionGroup(...)` receiver.
 *
 * Ends at the first top-level `;` or `,` or at the close of the enclosing
 * bracket. The comma matters: `cleanupStaleLiveKitCalls` puts two independent
 * `collectionGroup('calls')` queries in one `Promise.all([…])`, and without it
 * the first query absorbs the second one's filters and demands an index for a
 * query nobody wrote.
 */
function chainAfter(source, startIndex) {
  let depth = 0;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      // Ran past the end of the enclosing block: the statement ended here.
      if (depth < 0) return source.slice(startIndex, index);
    } else if ((char === ';' || char === ',') && depth === 0) return source.slice(startIndex, index);
  }
  return source.slice(startIndex);
}

/** `let query = firestore.collectionGroup(…)` → `query`. */
function assignedName(source, matchIndex) {
  const before = source.slice(Math.max(0, matchIndex - 120), matchIndex);
  return before.match(/(?:const|let|var\s)?\s*([A-Za-z_$][\w$]*)\s*=\s*[\w.$]*$/)?.[1] ?? null;
}

/**
 * A query held in a variable can pick up filters in a later statement, which
 * the chain walk above has already stopped at. Follow the variable far enough
 * to catch them: only as far as the next query in the file, so an unrelated
 * `query` in the next function cannot bleed into this one's requirement.
 */
function continuationFor(source, name, fromIndex) {
  if (!name) return '';
  const rest = source.slice(fromIndex);
  const nextQuery = rest.search(/\bcollectionGroup\(|\bfirestore\.collection\(/);
  const window = rest.slice(0, nextQuery === -1 ? 2000 : Math.min(nextQuery, 2000));
  const escaped = name.replace(/[$]/g, '\\$&');
  return [...window.matchAll(new RegExp(`\\b${escaped}\\s*\\.\\s*(?:where|orderBy)\\([^;]*`, 'g'))]
    .map((match) => match[0])
    .join('\n');
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/**
 * Extracts every `collectionGroup('name')` query in one source file, with the
 * fields each one constrains.
 *
 * @returns {Array<{collectionGroup: string, line: number, equality: string[], range: string[], orderBy: string[]}>}
 */
export function extractCollectionGroupQueries(source, file = '<source>') {
  const queries = [];
  const receiver = /\bcollectionGroup\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let match;
  while ((match = receiver.exec(source)) !== null) {
    const head = chainAfter(source, receiver.lastIndex);
    const name = assignedName(source, match.index);
    const chain = `${head}\n${continuationFor(source, name, receiver.lastIndex + head.length)}`;
    const equality = [];
    const range = [];
    const orderBy = [];

    const filters = /\.where\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g;
    let filter;
    while ((filter = filters.exec(chain)) !== null) {
      const [, field, operator] = filter;
      if (EQUALITY_OPERATORS.has(operator)) equality.push(field);
      else if (RANGE_OPERATORS.has(operator)) range.push(field);
      // An operator this extractor does not know is still a constraint on that
      // field. Treat it as a range: that is the stricter requirement, so an
      // unrecognised operator can only ever over-report, never under-report.
      else range.push(field);
    }

    // One level of nesting on purpose: the argument is either a string literal
    // or `FieldPath.documentId()`, and a bare `[^,)]+` stops inside the latter.
    const orders = /\.orderBy\(\s*((?:[^,()]|\([^()]*\))+)/g;
    let order;
    while ((order = orders.exec(chain)) !== null) {
      const argument = order[1].trim();
      if (DOCUMENT_ID_ORDER.test(argument)) continue;
      const literal = argument.match(/^['"`]([^'"`]+)['"`]$/);
      // A non-literal orderBy cannot be resolved statically. Record it so the
      // requirement is visibly unsatisfiable rather than quietly absent.
      orderBy.push(literal ? literal[1] : argument);
    }

    queries.push({
      file,
      collectionGroup: match[1],
      line: lineOf(source, match.index),
      equality,
      range,
      orderBy,
    });
  }
  return queries;
}

/** The distinct fields a query needs indexed, equalities first. */
function requiredFields(query) {
  const seen = new Set();
  const ordered = [];
  for (const field of [...query.equality, ...query.range, ...query.orderBy]) {
    if (seen.has(field)) continue;
    seen.add(field);
    ordered.push(field);
  }
  return ordered;
}

function servesSingleField(indexes, collectionGroup, field) {
  return (indexes.fieldOverrides ?? []).some((override) => (
    override.collectionGroup === collectionGroup
    && override.fieldPath === field
    && (override.indexes ?? []).some((entry) => entry.queryScope === 'COLLECTION_GROUP')
  ));
}

function servesComposite(indexes, collectionGroup, fields) {
  return (indexes.indexes ?? []).some((index) => {
    if (index.collectionGroup !== collectionGroup) return false;
    if (index.queryScope !== 'COLLECTION_GROUP') return false;
    const declared = new Set((index.fields ?? []).map((entry) => entry.fieldPath));
    return fields.every((field) => declared.has(field));
  });
}

/**
 * @returns {Array<{query: object, fields: string[], kind: 'single-field'|'composite', remedy: string}>}
 *   one entry per query the declared indexes cannot serve.
 */
export function missingIndexes(queries, indexes) {
  const missing = [];
  for (const query of queries) {
    const fields = requiredFields(query);
    // An unfiltered, unordered collection-group read is served by the key index
    // Firestore always maintains. `reconcileMembershipMirrors` relies on that.
    if (fields.length === 0) continue;

    if (fields.length === 1) {
      const [field] = fields;
      if (servesSingleField(indexes, query.collectionGroup, field)) continue;
      missing.push({
        query,
        fields,
        kind: 'single-field',
        remedy: `add a fieldOverrides entry for ${query.collectionGroup}.${field} that includes `
          + '{ "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }',
      });
      continue;
    }

    if (servesComposite(indexes, query.collectionGroup, fields)) continue;
    missing.push({
      query,
      fields,
      kind: 'composite',
      remedy: `add a COLLECTION_GROUP index on ${query.collectionGroup} covering ${fields.join(', ')}`,
    });
  }
  return missing;
}

export function describeMissing(entry) {
  const { query, fields, kind, remedy } = entry;
  return `${query.file}:${query.line} collectionGroup('${query.collectionGroup}') needs a `
    + `${kind} COLLECTION_GROUP index on [${fields.join(', ')}] — ${remedy}`;
}
