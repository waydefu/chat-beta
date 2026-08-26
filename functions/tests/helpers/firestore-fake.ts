/**
 * An in-memory stand-in for the Firestore handle exported by `functions/src/admin.ts`.
 *
 * It exists because `rate-limit.ts`, `context-builder.ts` and the
 * `generateGeminiReply` callable reach Firestore directly, so none of them could
 * be tested without a boundary (TD-A2/TD-A3). It implements only the surface
 * those three files actually use — enough to make transaction, ordering and
 * limit behaviour observable, and no more.
 */

export interface FakeTimestamp {
  toMillis(): number;
}

export function timestamp(millis: number): FakeTimestamp {
  return { toMillis: () => millis };
}

type DocumentData = Record<string, unknown>;

export interface FakeSnapshot {
  id: string;
  exists: boolean;
  data(): DocumentData | undefined;
}

export interface FakeDocumentRef {
  id: string;
  path: string;
  get(): Promise<FakeSnapshot>;
  set(data: DocumentData, options?: { merge?: boolean }): Promise<void>;
}

export interface WriteRecord {
  path: string;
  data: DocumentData;
  merge: boolean;
  operation: 'set' | 'create' | 'update';
}

function snapshotOf(store: Map<string, DocumentData>, path: string): FakeSnapshot {
  const id = path.split('/').at(-1) ?? path;
  const data = store.get(path);
  return { id, exists: data !== undefined, data: () => (data ? { ...data } : undefined) };
}

function applyWrite(
  store: Map<string, DocumentData>,
  writes: WriteRecord[],
  operation: WriteRecord['operation'],
  path: string,
  data: DocumentData,
  merge: boolean,
): void {
  if (operation === 'create' && store.has(path)) {
    throw new Error(`document already exists: ${path}`);
  }
  writes.push({ path, data: { ...data }, merge, operation });
  const previous = merge ? store.get(path) ?? {} : {};
  store.set(path, { ...previous, ...data });
}

/**
 * A single ordered collection query. Only the operators the production code
 * uses are supported; anything else throws rather than silently returning a
 * wrong result, so a future query change fails loudly here instead of in
 * production.
 */
class FakeQuery {
  constructor(
    private readonly docs: Array<{ id: string; path: string; data: DocumentData }>,
    private readonly field: string | null = null,
    private readonly direction: 'asc' | 'desc' = 'asc',
    private readonly bound: { kind: 'startAt' | 'endAt'; value: FakeTimestamp } | null = null,
    private readonly maximum: number | null = null,
  ) {}

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): FakeQuery {
    return new FakeQuery(this.docs, field, direction, this.bound, this.maximum);
  }

  startAt(value: FakeTimestamp): FakeQuery {
    return new FakeQuery(this.docs, this.field, this.direction, { kind: 'startAt', value }, this.maximum);
  }

  endAt(value: FakeTimestamp): FakeQuery {
    return new FakeQuery(this.docs, this.field, this.direction, { kind: 'endAt', value }, this.maximum);
  }

  limit(maximum: number): FakeQuery {
    return new FakeQuery(this.docs, this.field, this.direction, this.bound, maximum);
  }

  async get(): Promise<{ docs: FakeSnapshot[] }> {
    const field = this.field ?? 'createdAt';
    const millisOf = (data: DocumentData): number => {
      const value = data[field] as FakeTimestamp | undefined;
      return typeof value?.toMillis === 'function' ? value.toMillis() : 0;
    };
    // Firestore drops documents that lack the ordered field from the result set
    // entirely. Reproducing that matters: a message written without `createdAt`
    // is invisible to these queries in production, and a fake that sorted it to
    // position zero would invent context the code never sees.
    let rows = this.docs.filter((row) => {
      const value = row.data[field] as FakeTimestamp | undefined;
      return typeof value?.toMillis === 'function';
    });
    rows.sort((left, right) => {
      const delta = millisOf(left.data) - millisOf(right.data);
      return this.direction === 'desc' ? -delta : delta;
    });
    if (this.bound) {
      const boundary = this.bound.value.toMillis();
      rows = rows.filter((row) => {
        const value = millisOf(row.data);
        // `startAt`/`endAt` are inclusive cursors along the current sort order.
        if (this.direction === 'desc') {
          return this.bound!.kind === 'startAt' ? value <= boundary : value >= boundary;
        }
        return this.bound!.kind === 'startAt' ? value >= boundary : value <= boundary;
      });
    }
    if (this.maximum !== null) rows = rows.slice(0, this.maximum);
    return {
      docs: rows.map((row) => ({
        id: row.id,
        exists: true,
        data: () => ({ ...row.data }),
      })),
    };
  }
}

export interface FakeFirestore {
  doc(path: string): FakeDocumentRef;
  collection(path: string): FakeQuery & { doc(id: string): FakeDocumentRef };
  runTransaction<T>(updateFunction: (transaction: FakeTransaction) => Promise<T>): Promise<T>;
}

export interface FakeTransaction {
  get(ref: FakeDocumentRef): Promise<FakeSnapshot>;
  set(ref: FakeDocumentRef, data: DocumentData, options?: { merge?: boolean }): void;
  create(ref: FakeDocumentRef, data: DocumentData): void;
  update(ref: FakeDocumentRef, data: DocumentData): void;
}

export interface FirestoreFake {
  firestore: FakeFirestore;
  /** Seed or overwrite a document without recording a write. */
  seed(path: string, data: DocumentData): void;
  /** Current stored value, or undefined. */
  read(path: string): DocumentData | undefined;
  /** Every write the code under test performed, in order. */
  writes: WriteRecord[];
  /** How many transactions were opened — a committed transaction counts once. */
  transactionCount: number;
  reset(): void;
}

export function createFirestoreFake(): FirestoreFake {
  const store = new Map<string, DocumentData>();
  const writes: WriteRecord[] = [];
  const counters = { transactions: 0 };

  const docRef = (path: string): FakeDocumentRef => ({
    id: path.split('/').at(-1) ?? path,
    path,
    async get() {
      return snapshotOf(store, path);
    },
    async set(data, options) {
      applyWrite(store, writes, 'set', path, data, Boolean(options?.merge));
    },
  });

  const firestore: FakeFirestore = {
    doc: docRef,
    collection(path: string) {
      const rows = [...store.entries()]
        .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map(([key, data]) => ({ id: key.split('/').at(-1)!, path: key, data }));
      const query = new FakeQuery(rows);
      return Object.assign(query, { doc: (id: string) => docRef(`${path}/${id}`) });
    },
    async runTransaction(updateFunction) {
      counters.transactions += 1;
      // Firestore buffers writes until commit; a throw must leave the store
      // untouched, which is exactly what the lease and rate-limit tests rely on.
      const staged: Array<() => void> = [];
      const transaction: FakeTransaction = {
        get: async (ref) => snapshotOf(store, ref.path),
        set: (ref, data, options) => {
          staged.push(() => applyWrite(store, writes, 'set', ref.path, data, Boolean(options?.merge)));
        },
        create: (ref, data) => {
          staged.push(() => applyWrite(store, writes, 'create', ref.path, data, false));
        },
        update: (ref, data) => {
          staged.push(() => applyWrite(store, writes, 'update', ref.path, data, true));
        },
      };
      const result = await updateFunction(transaction);
      for (const commit of staged) commit();
      return result;
    },
  };

  return {
    firestore,
    seed(path, data) {
      store.set(path, { ...data });
    },
    read(path) {
      const data = store.get(path);
      return data ? { ...data } : undefined;
    },
    writes,
    get transactionCount() {
      return counters.transactions;
    },
    reset() {
      store.clear();
      writes.length = 0;
      counters.transactions = 0;
    },
  };
}
