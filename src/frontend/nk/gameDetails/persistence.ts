// nk: #5 - persistence of the game details cache.
// IndexedDB database `nk-game-details` (one object store, key = DetailsKey).
// IndexedDB is per origin: the dev server and the packaged app keep separate
// caches. MemoryPersistence backs the unit tests and is the fallback when
// IndexedDB is unavailable.
import type { DetailsKey, Entries, GameDetailsEntry } from './types'

export interface DetailsPersistence {
  loadAll: () => Promise<Entries>
  putMany: (
    entries: Array<[DetailsKey, GameDetailsEntry]>,
    signal?: AbortSignal
  ) => Promise<void>
  deleteMany: (keys: DetailsKey[], signal?: AbortSignal) => Promise<void>
  clear: (signal?: AbortSignal) => Promise<void>
}

// Cancellation fences an operation still waiting for an earlier transaction or
// database open. The underlying promise remains observed after cancellation.
export function waitForPersistence<T>(
  work: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return work
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(new Error('Persistence operation cancelled'))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    void work.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        if (!signal.aborted) resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}

export class MemoryPersistence implements DetailsPersistence {
  readonly data = new Map<DetailsKey, GameDetailsEntry>()
  putCalls = 0

  loadAll() {
    return Promise.resolve(Object.fromEntries(this.data))
  }

  putMany(
    entries: Array<[DetailsKey, GameDetailsEntry]>,
    signal?: AbortSignal
  ) {
    if (signal?.aborted)
      return Promise.reject(new Error('Persistence operation cancelled'))
    this.putCalls++
    for (const [key, entry] of entries) this.data.set(key, entry)
    return Promise.resolve()
  }

  deleteMany(keys: DetailsKey[], signal?: AbortSignal) {
    if (signal?.aborted)
      return Promise.reject(new Error('Persistence operation cancelled'))
    for (const key of keys) this.data.delete(key)
    return Promise.resolve()
  }

  clear(signal?: AbortSignal) {
    if (signal?.aborted)
      return Promise.reject(new Error('Persistence operation cancelled'))
    this.data.clear()
    return Promise.resolve()
  }
}

const DB_NAME = 'nk-game-details'
const DB_VERSION = 2 // 2: no timestamps; extra info per language slot
const STORE = 'entries'

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IDB request'))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('IDB transaction'))
  })
}

export class IndexedDbPersistence implements DetailsPersistence {
  private db: Promise<IDBDatabase> | null = null

  constructor(private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const request = this.factory.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
          // a new schema version starts from an empty cache
          const db = request.result
          if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE)
          db.createObjectStore(STORE)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IDB open'))
        request.onblocked = () => reject(new Error('IndexedDB open blocked'))
      })
      this.db.catch(() => {
        this.db = null
      })
    }
    return this.db
  }

  async loadAll(): Promise<Entries> {
    const db = await this.open()
    const store = db.transaction(STORE, 'readonly').objectStore(STORE)
    const [keys, values] = await Promise.all([
      promisify(store.getAllKeys()),
      promisify(store.getAll() as IDBRequest<GameDetailsEntry[]>)
    ])
    const entries: Entries = {}
    keys.forEach((key, i) => {
      if (typeof key === 'string' && values[i]) entries[key] = values[i]
    })
    return entries
  }

  async putMany(
    entries: Array<[DetailsKey, GameDetailsEntry]>,
    signal?: AbortSignal
  ) {
    if (entries.length === 0) return
    const db = await waitForPersistence(this.open(), signal)
    if (signal?.aborted) throw new Error('Persistence operation cancelled')
    const tx = db.transaction(STORE, 'readwrite')
    const abort = () => {
      try {
        tx.abort()
      } catch {
        /* already completed */
      }
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const completed = done(tx)
      const store = tx.objectStore(STORE)
      for (const [key, entry] of entries) store.put(entry, key)
      await waitForPersistence(completed, signal)
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  async deleteMany(keys: DetailsKey[], signal?: AbortSignal) {
    if (keys.length === 0) return
    const db = await waitForPersistence(this.open(), signal)
    if (signal?.aborted) throw new Error('Persistence operation cancelled')
    const tx = db.transaction(STORE, 'readwrite')
    const abort = () => {
      try {
        tx.abort()
      } catch {
        /* already completed */
      }
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const completed = done(tx)
      const store = tx.objectStore(STORE)
      for (const key of keys) store.delete(key)
      await waitForPersistence(completed, signal)
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  async clear(signal?: AbortSignal) {
    const db = await waitForPersistence(this.open(), signal)
    if (signal?.aborted) throw new Error('Persistence operation cancelled')
    const tx = db.transaction(STORE, 'readwrite')
    const abort = () => {
      try {
        tx.abort()
      } catch {
        /* already completed */
      }
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const completed = done(tx)
      tx.objectStore(STORE).clear()
      await waitForPersistence(completed, signal)
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }
}
