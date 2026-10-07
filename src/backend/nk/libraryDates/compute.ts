// nk: #3 - pure logic for the library-dates side store.
// Only imports common/* so it can be unit-tested without electron, the logger
// or the store managers.
import type { GameInfo, Runner } from 'common/types'
import type { GalaxyLibraryEntry } from 'common/types/gog'
import {
  libraryDateKey,
  type LibraryDateEntry,
  type LibraryDateSource,
  type LibraryDatesFile
} from 'common/types/nk/libraryDates'
import { normaliseEpoch } from 'common/nk/librarySort'

export const STORE_DATE_SOURCE: Partial<Record<Runner, LibraryDateSource>> = {
  legendary: 'epic-entitlement',
  gog: 'gog-galaxy',
  nile: 'amazon-entitlement'
}

export function emptyLibraryDates(): LibraryDatesFile {
  return { version: 1, dates: {}, initializedRunners: {} }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Accepts whatever was read from disk and returns a well-formed file. */
export function sanitiseLibraryDates(raw: unknown): LibraryDatesFile {
  const file = emptyLibraryDates()
  if (!isRecord(raw)) return file
  if (isRecord(raw.dates)) {
    for (const [key, entry] of Object.entries(raw.dates)) {
      if (
        isRecord(entry) &&
        typeof entry.added === 'number' &&
        Number.isFinite(entry.added) &&
        typeof entry.source === 'string'
      ) {
        file.dates[key] = {
          added: entry.added,
          source: entry.source as LibraryDateSource
        }
      }
    }
  }
  if (isRecord(raw.initializedRunners)) {
    for (const [runner, value] of Object.entries(raw.initializedRunners)) {
      if (value === true) file.initializedRunners[runner as Runner] = true
    }
  }
  return file
}

/**
 * Merges store-provided dates (keyed by app_name) for one runner into
 * `dates` in place. A valid store date always wins over first-seen/seed.
 * Returns how many entries changed.
 */
function applyStoreDates(
  dates: Record<string, LibraryDateEntry>,
  runner: Runner,
  storeDates: Map<string, number>
): number {
  const source = STORE_DATE_SOURCE[runner]
  if (!source) return 0
  let changed = 0
  for (const [appName, added] of storeDates) {
    if (!Number.isFinite(added) || added <= 0) continue
    const key = libraryDateKey(appName, runner)
    const prev = dates[key]
    if (prev && prev.added === added && prev.source === source) continue
    dates[key] = { added, source }
    changed++
  }
  return changed
}

export interface LibraryDatesInput {
  runner: Runner
  games: GameInfo[]
  /** app_name -> epoch ms, only for games the store reports a date for */
  storeDates: Map<string, number>
}

export function computeLibraryDates(
  prev: LibraryDatesFile,
  inputs: LibraryDatesInput[],
  now: number
): { next: LibraryDatesFile; changed: boolean; changedCount: number } {
  const next: LibraryDatesFile = {
    version: 1,
    dates: { ...prev.dates },
    initializedRunners: { ...prev.initializedRunners }
  }
  let changedCount = 0

  for (const { runner, games, storeDates } of inputs) {
    // only store dates for games that are actually in the library
    const relevant = new Map<string, number>()
    for (const game of games) {
      const d = storeDates.get(game.app_name)
      if (d !== undefined) relevant.set(game.app_name, d)
    }
    changedCount += applyStoreDates(next.dates, runner, relevant)

    const initialized = next.initializedRunners[runner] === true
    games.forEach((game, index) => {
      const key = libraryDateKey(game.app_name, runner)
      if (next.dates[key]) return
      next.dates[key] = initialized
        ? { added: now, source: 'first-seen' }
        : // first population of a runner: keep store order, at the bottom
          { added: index + 1, source: 'seed' }
      changedCount++
    })

    // Sideloaded apps are local and added one at a time, so an empty sideload
    // library is a real (initialized) state: the first app added later must be
    // first-seen = now (top in newest-first), not a bottom-of-list seed.
    // Store runners only count as initialized once their bulk list arrived.
    if (!initialized && (games.length > 0 || runner === 'sideload')) {
      next.initializedRunners[runner] = true
      changedCount++
    }
  }

  return { next, changed: changedCount > 0, changedCount }
}

/**
 * Merges dates for one runner outside of a library update (used for the GOG
 * Galaxy response, which is only available during the GOG refresh).
 */
export function mergeStoreDates(
  prev: LibraryDatesFile,
  runner: Runner,
  storeDates: Map<string, number>
): { next: LibraryDatesFile; changed: boolean; changedCount: number } {
  const next: LibraryDatesFile = {
    version: 1,
    dates: { ...prev.dates },
    initializedRunners: { ...prev.initializedRunners }
  }
  const changedCount = applyStoreDates(next.dates, runner, storeDates)
  return { next, changed: changedCount > 0, changedCount }
}

/**
 * Epic: `entitlements.json` (legendary internal cache) -> app_name -> min
 * grantDate of the game's namespace. Only ACTIVE entitlements count.
 * Never touches accountId / identityId.
 */
export function epicNamespaceDates(
  entitlementsJson: unknown,
  games: Pick<GameInfo, 'app_name' | 'namespace'>[],
  now: number = Date.now()
): { dates: Map<string, number>; activeEntitlements: number } {
  const dates = new Map<string, number>()
  if (!Array.isArray(entitlementsJson)) {
    return { dates, activeEntitlements: 0 }
  }
  const byNamespace = new Map<string, number>()
  let activeEntitlements = 0
  for (const ent of entitlementsJson) {
    if (!isRecord(ent) || ent.status !== 'ACTIVE') continue
    activeEntitlements++
    if (typeof ent.namespace !== 'string' || !ent.namespace) continue
    const grant = normaliseEpoch(
      typeof ent.grantDate === 'string' || typeof ent.grantDate === 'number'
        ? ent.grantDate
        : undefined,
      now
    )
    if (grant === undefined) continue
    const prev = byNamespace.get(ent.namespace)
    if (prev === undefined || grant < prev)
      byNamespace.set(ent.namespace, grant)
  }
  for (const game of games) {
    if (!game.namespace) continue
    const d = byNamespace.get(game.namespace)
    if (d !== undefined) dates.set(game.app_name, d)
  }
  return { dates, activeEntitlements }
}

/**
 * Amazon: nile `library.json` -> product.id -> entitlementDateFromEpoch
 * (a string of epoch ms). Never touches `signature`.
 */
export function amazonDates(
  libraryJson: unknown,
  now: number = Date.now()
): Map<string, number> {
  const dates = new Map<string, number>()
  if (!Array.isArray(libraryJson)) return dates
  for (const ent of libraryJson) {
    if (!isRecord(ent) || !isRecord(ent.product)) continue
    const id = ent.product.id
    if (typeof id !== 'string' || !id) continue
    const raw = ent.entitlementDateFromEpoch
    const d = normaliseEpoch(
      typeof raw === 'string' || typeof raw === 'number' ? raw : undefined,
      now
    )
    if (d !== undefined) dates.set(id, d)
  }
  return dates
}

/**
 * GOG: Galaxy library entries -> external_id -> owned_since ?? date_created.
 * `certificate` is never read.
 */
export function gogGalaxyDates(
  entries: unknown,
  now: number = Date.now()
): Map<string, number> {
  const dates = new Map<string, number>()
  if (!Array.isArray(entries)) return dates
  for (const entry of entries as Partial<GalaxyLibraryEntry>[]) {
    if (!isRecord(entry) || entry.platform_id !== 'gog') continue
    const id = entry.external_id
    if (typeof id !== 'string' && typeof id !== 'number') continue
    const d =
      normaliseEpoch(entry.owned_since ?? undefined, now) ??
      normaliseEpoch(entry.date_created ?? undefined, now)
    if (d !== undefined) dates.set(String(id), d)
  }
  return dates
}
