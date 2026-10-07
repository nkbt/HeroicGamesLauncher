// nk: #3 - pure helpers for sorting the library by date added.
// No DOM / electron imports: shared by backend, frontend and tests.
import type { GameInfo } from 'common/types'
import {
  libraryDateKey,
  type LibraryDateEntry
} from 'common/types/nk/libraryDates'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
/** Values below this are treated as Unix seconds (1e11 s is year 5138). */
const SECONDS_THRESHOLD = 1e11
const NUMERIC_STRING = /^\d+(\.\d+)?$/

/**
 * Normalises an ISO string, epoch-ms number/string or epoch-seconds value to
 * epoch milliseconds. Returns undefined for anything unusable (null, NaN, <= 0
 * or more than one day in the future).
 */
export function normaliseEpoch(
  v: number | string | null | undefined,
  now: number = Date.now()
): number | undefined {
  let n: number
  if (typeof v === 'number') {
    n = v
  } else if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return undefined
    // Numeric strings first: Date.parse('1577836800123') is NaN
    n = NUMERIC_STRING.test(s) ? Number(s) : Date.parse(s)
  } else {
    return undefined
  }
  if (!Number.isFinite(n) || n <= 0) return undefined
  if (n < SECONDS_THRESHOLD) n *= 1000
  n = Math.round(n)
  if (n > now + ONE_DAY_MS) return undefined
  return n
}

/**
 * Stable sort by date added. Games without a date count as the newest
 * (top in newest-first, bottom in oldest-first). Ties keep the input order,
 * so a preceding title sort acts as the tie-break.
 */
export function sortGamesByDateAdded(
  games: GameInfo[],
  dates: Record<string, LibraryDateEntry | undefined>,
  newestFirst: boolean
): GameInfo[] {
  const decorated = games.map((game, index) => {
    const entry = dates[libraryDateKey(game.app_name, game.runner)]
    const added =
      entry && typeof entry.added === 'number' && Number.isFinite(entry.added)
        ? entry.added
        : Number.MAX_SAFE_INTEGER
    return { game, added, index }
  })
  decorated.sort((a, b) => {
    if (a.added !== b.added) {
      const aFirst = newestFirst ? a.added > b.added : a.added < b.added
      return aFirst ? -1 : 1
    }
    return a.index - b.index
  })
  return decorated.map(({ game }) => game)
}
