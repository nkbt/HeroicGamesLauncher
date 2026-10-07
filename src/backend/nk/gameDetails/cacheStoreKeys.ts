// nk: #5 - top-level keys of an upstream `CacheStore`, without editing
// backend/cache.ts. Keep in sync with backend/cache.ts: `current_store` is
// either the electron-store (`.store` is the whole object) or, between
// `use_in_memory()` and `commit()`, a `Map`. Returns null when the shape
// changed, so callers can warn and fall back.
export function cacheStoreKeys(cacheStore: unknown): string[] | null {
  const current = (cacheStore as { current_store?: unknown } | null)
    ?.current_store
  if (current instanceof Map) return [...(current.keys() as Iterable<string>)]
  const data = (current as { store?: unknown } | null | undefined)?.store
  if (data && typeof data === 'object') return Object.keys(data)
  return null
}

/**
 * Deletes every top-level key starting with `prefix` through the store's
 * own `delete` (which also drops the `__timestamp` sibling). Returns the
 * number of keys deleted, or null when the keys cannot be listed.
 */
export function deleteByPrefix(
  cacheStore: { delete: (key: string) => void },
  prefix: string
): number | null {
  const keys = cacheStoreKeys(cacheStore)
  if (!keys) return null
  const matching = keys.filter((key) => key.startsWith(prefix))
  for (const key of matching) cacheStore.delete(key)
  return matching.length
}
