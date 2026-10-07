// nk: #5 - selected CacheStore instances retain their public TTL/Map logic.
import {
  deletePath,
  getPath,
  hasPath,
  normalizePathArrays,
  setPath
} from './paths'

interface BackingStore {
  store: Record<string, unknown>
  clear: () => void
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
  has: (key: string) => boolean
  delete: (key: string) => void
  [Symbol.iterator]: () => IterableIterator<[string, unknown]>
}
interface Target {
  store: BackingStore
  current_store: BackingStore | Map<string, unknown>
  using_in_memory: boolean
  in_memory_store: Map<string, unknown>
  use_in_memory: () => void
  commit: () => void
}
interface Memoized {
  flush: () => void
  suppress: () => void
  resume: () => void
}
const installed = new WeakMap<object, Memoized>()
const warned = new WeakSet<object>()
const registry = new Set<Memoized>()

// Lifecycle methods may be inherited, but replacing them needs an own slot.
function canReplaceProperty(targetValue: object, key: string) {
  let owner: object | null = targetValue
  while (owner !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key)
    if (descriptor) {
      if (!('value' in descriptor) || descriptor.writable !== true) return false
      return owner === targetValue || Object.isExtensible(targetValue)
    }
    owner = Object.getPrototypeOf(owner) as object | null
  }
  return false
}

export function memoizeCacheStore(
  targetValue: unknown,
  warn: (message: string) => void,
  flushDelayMs = 1000
) {
  if (!targetValue || typeof targetValue !== 'object') {
    warn('[nk] cache memoization: unexpected instance')
    return false
  }
  if (installed.has(targetValue)) return true
  const target = targetValue as Target
  if (
    !target.store ||
    typeof target.store.clear !== 'function' ||
    typeof target.store.get !== 'function' ||
    typeof target.store.has !== 'function' ||
    typeof target.store.delete !== 'function' ||
    typeof target.store.set !== 'function' ||
    typeof target.store[Symbol.iterator] !== 'function' ||
    !('store' in target.store) ||
    typeof target.use_in_memory !== 'function' ||
    target.use_in_memory.length !== 0 ||
    typeof target.commit !== 'function' ||
    target.commit.length !== 0 ||
    !canReplaceProperty(targetValue, 'use_in_memory') ||
    !canReplaceProperty(targetValue, 'commit') ||
    !canReplaceProperty(targetValue, 'current_store') ||
    typeof target.using_in_memory !== 'boolean' ||
    !(target.in_memory_store instanceof Map) ||
    (target.using_in_memory
      ? target.current_store !== target.in_memory_store
      : target.current_store !== target.store) ||
    !Number.isFinite(flushDelayMs) ||
    flushDelayMs < 0
  ) {
    if (!warned.has(targetValue)) {
      warned.add(targetValue)
      warn('[nk] cache memoization: unexpected CacheStore shape')
    }
    return false
  }
  const backingStore = target.store
  const use_in_memory = target.use_in_memory
  const commit = target.commit
  let snapshot: Record<string, unknown> | null = null
  let dirty = false
  let suppressed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  function cancelTimer() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  function load() {
    if (snapshot === null) {
      const store = backingStore.store
      if (!store || typeof store !== 'object' || Array.isArray(store)) {
        throw new TypeError('Unexpected cache backing data')
      }
      snapshot = store
    }
    return snapshot
  }
  function flush() {
    cancelTimer()
    if (!dirty || suppressed || target.using_in_memory) return
    // Only a successful synchronous backing write clears dirty state.
    backingStore.store = load()
    dirty = false
  }
  function changed() {
    dirty = true
    if (suppressed || timer !== undefined) return
    timer = setTimeout(
      () => {
        timer = undefined
        try {
          flush()
        } catch (error) {
          warn(`[nk] cache memoization: flush failed: ${String(error)}`)
          changed()
        }
      },
      Math.min(flushDelayMs, 2000)
    )
    timer.unref?.()
  }
  const adapter = {
    get store() {
      // Stock store access returns a newly parsed, null-prototype root.
      return Object.assign(
        Object.create(null),
        structuredClone(load())
      ) as Record<string, unknown>
    },
    get: (key: string) => {
      const value = getPath(load(), key)
      // Only the requested entry needs copying; avoid cloning the whole cache
      // for every read. Missing/default values remain the upstream caller's.
      return value !== null && typeof value === 'object'
        ? structuredClone(value)
        : value
    },
    has: (key: string) => hasPath(load(), key),
    set: (key: string, value: unknown) => {
      if (suppressed) return
      if (typeof key !== 'string') throw new TypeError('Invalid cache key')
      if (key.startsWith('__internal__.')) {
        throw new TypeError('Reserved cache key')
      }
      if (
        value === undefined ||
        typeof value === 'symbol' ||
        typeof value === 'function'
      ) {
        throw new TypeError('Invalid cache value')
      }
      // Normalize only the entry, preserving synchronous JSON errors and values
      // without serializing the entire store on every CacheStore.set call.
      const serializedValue = JSON.stringify(value)
      if (serializedValue === undefined) {
        // JSON omits a property whose custom toJSON returns undefined.
        setPath(load(), key, undefined)
        deletePath(load(), key)
      } else {
        setPath(load(), key, JSON.parse(serializedValue))
      }
      normalizePathArrays(load(), key)
      changed()
    },
    delete: (key: string) => {
      if (suppressed) return
      deletePath(load(), key)
      normalizePathArrays(load(), key)
      changed()
    },
    clear: () => {
      if (suppressed) return
      // A failed clear retains the dirty snapshot for retry/exit flushing.
      backingStore.clear()
      cancelTimer()
      snapshot = null
      dirty = false
    }
  }
  target.use_in_memory = function () {
    if (suppressed) return
    flush()
    cancelTimer()
    use_in_memory.call(this)
    snapshot = null
  }
  target.commit = function () {
    if (suppressed) return
    if (!this.using_in_memory) return commit.call(this)
    commit.call(this)
    cancelTimer()
    snapshot = null
    dirty = false
    this.current_store = adapter as BackingStore
  }
  if (!target.using_in_memory) target.current_store = adapter as BackingStore
  const memoized: Memoized = {
    flush,
    suppress: () => {
      suppressed = true
      cancelTimer()
      // Keep a memory-only checkpoint if the destructive reset throws.
    },
    resume: () => {
      suppressed = false
      if (dirty) changed()
    }
  }
  installed.set(targetValue, memoized)
  registry.add(memoized)
  return true
}

export function flushMemoizedCaches(warn: (message: string) => void) {
  for (const memoized of registry) {
    try {
      memoized.flush()
    } catch (error) {
      warn(`[nk] cache memoization: exit flush failed: ${String(error)}`)
    }
  }
}
export function suppressMemoizedCaches() {
  for (const memoized of registry) memoized.suppress()
}
export function resumeMemoizedCaches() {
  for (const memoized of registry) memoized.resume()
}
