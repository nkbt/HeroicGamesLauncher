// nk: #4 - list sharing for library refreshes.
//
// A library refresh rebuilds every GameInfo object even when nothing changed.
// These helpers match games by `runner:app_name` and compare their list data
// structurally (GameInfo is plain JSON data), so callers can keep the
// previous object of every unchanged game and tell which games changed.
// Pure, no React.
import type { GameInfo } from 'common/types'

/** The key of a game across library lists: `runner:app_name`. */
export function gameKey({
  runner,
  app_name
}: Pick<GameInfo, 'runner' | 'app_name'>): string {
  return `${runner}:${app_name}`
}

/** Deep equality for plain JSON values (objects, arrays, primitives). */
function isDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((item, i) => isDeepEqual(item, b[i]))
  }
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const keys = Object.keys(aRecord)
  if (keys.length !== Object.keys(bRecord).length) return false
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) &&
      isDeepEqual(aRecord[key], bRecord[key])
  )
}

function indexByKey(list: GameInfo[] | undefined): Map<string, GameInfo> {
  const byKey = new Map<string, GameInfo>()
  for (const gameInfo of list ?? []) {
    const key = gameKey(gameInfo)
    if (!byKey.has(key)) byKey.set(key, gameInfo)
  }
  return byKey
}

/**
 * `next` with every game that is deep-equal to its entry in `prev` replaced
 * by the previous object. Returns `prev` itself when the result has the same
 * length and every element is the element at the same index in `prev`.
 */
export function shareGameList(
  prev: GameInfo[] | undefined,
  next: GameInfo[]
): GameInfo[] {
  if (prev === undefined) return next
  const previous = indexByKey(prev)
  const shared = next.map((gameInfo) => {
    const old = previous.get(gameKey(gameInfo))
    return old !== undefined && isDeepEqual(old, gameInfo) ? old : gameInfo
  })
  const unchanged =
    shared.length === prev.length &&
    shared.every((gameInfo, i) => gameInfo === prev[i])
  return unchanged ? prev : shared
}

/** Keys (`runner:app_name`) of the games added, removed or changed. */
export function changedGameKeys(
  prev: GameInfo[] | undefined,
  next: GameInfo[]
): Set<string> {
  const previous = indexByKey(prev)
  const changed = new Set<string>()
  const present = new Set<string>()
  for (const gameInfo of next) {
    const key = gameKey(gameInfo)
    present.add(key)
    const old = previous.get(key)
    if (old === undefined || !isDeepEqual(old, gameInfo)) changed.add(key)
  }
  for (const key of previous.keys()) {
    if (!present.has(key)) changed.add(key)
  }
  return changed
}
