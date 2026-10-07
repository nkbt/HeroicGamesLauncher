// nk: #4 - structural sharing for the GlobalState context value.
//
// GlobalState rebuilds every library array from the store caches on each
// refresh (startup refresh, refresh button, game status events), so every
// GameInfo is a new object even when nothing changed. Sharing the new value
// with the previous one keeps the previous object for every part that is
// deep-equal: unchanged games keep their identity (their cards and memos see
// no change), and when nothing changed at all the previous value itself is
// returned. Pure, no React; applied by KeepAliveLibrary.
//
// Only plain objects and arrays are compared structurally. Anything else
// (functions, class instances, React elements, Dates, ...) compares by
// identity. Arrays of games are matched by `runner:app_name` (gameKey), so an
// added or removed game does not defeat sharing for the games after it.
import type { GameInfo } from 'common/types'
import { gameKey } from 'frontend/nk/librarySharing'

const MAX_DEPTH = 32

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value) as unknown
  if (proto !== Object.prototype && proto !== null) return false
  // React elements (e.g. a dialog message) carry hidden dev-only fields and
  // must never be rebuilt
  return !('$$typeof' in value)
}

/** gameKey of a value that looks like a GameInfo, otherwise null */
function gameKeyOf(value: unknown): string | null {
  if (!isPlainObject(value)) return null
  if (typeof value.app_name !== 'string') return null
  return gameKey(value as unknown as GameInfo)
}

function shareArray(prev: unknown[], next: unknown[], depth: number) {
  let byKey: Map<string, unknown> | null = null
  let same = prev.length === next.length
  const out = new Array<unknown>(next.length)
  for (let i = 0; i < next.length; i++) {
    const item = next[i]
    let candidate: unknown = prev[i]
    const key = gameKeyOf(item)
    if (key !== null && gameKeyOf(candidate) !== key) {
      if (byKey === null) {
        byKey = new Map()
        for (const p of prev) {
          const k = gameKeyOf(p)
          if (k !== null && !byKey.has(k)) byKey.set(k, p)
        }
      }
      candidate = byKey.get(key)
    }
    const shared = share(candidate, item, depth + 1)
    out[i] = shared
    if (!Object.is(shared, prev[i])) same = false
  }
  return same ? prev : out
}

function shareObject(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  depth: number
) {
  const nextKeys = Object.keys(next)
  let same = nextKeys.length === Object.keys(prev).length
  const out: Record<string, unknown> = {}
  for (const key of nextKeys) {
    const has = Object.prototype.hasOwnProperty.call(prev, key)
    const shared = has ? share(prev[key], next[key], depth + 1) : next[key]
    out[key] = shared
    if (!has || !Object.is(shared, prev[key])) same = false
  }
  return same ? prev : out
}

function share(prev: unknown, next: unknown, depth: number): unknown {
  if (Object.is(prev, next)) return prev
  if (depth > MAX_DEPTH) return next
  if (Array.isArray(prev) && Array.isArray(next)) {
    return shareArray(prev, next, depth)
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    return shareObject(prev, next, depth)
  }
  return next
}

/**
 * `next` with every part that is deep-equal to `prev` replaced by the part of
 * `prev`. Returns `prev` itself when the two are deep-equal.
 */
export function structuralShare<T>(prev: T, next: T): T {
  return share(prev, next, 0) as T
}
