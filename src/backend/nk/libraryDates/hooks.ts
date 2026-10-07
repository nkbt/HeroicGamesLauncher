// nk: #3 - instance-level wrappers that hook the library-dates updater into
// upstream library managers without editing upstream files.
// Pure (dependencies injected) so it can be unit-tested with fake managers.
import type { Runner } from 'common/types'

export const ALL_RUNNERS: Runner[] = [
  'legendary',
  'gog',
  'nile',
  'sideload',
  'zoom'
]

const WRAPPED = Symbol.for('nk.libraryDates.wrapped')

type AnyFn = ((...args: unknown[]) => unknown) & { [WRAPPED]?: true }

function isFn(v: unknown): v is AnyFn {
  return typeof v === 'function'
}

function safely(fn: () => void, warn: (msg: string) => void, what: string) {
  try {
    fn()
  } catch (error) {
    warn(`[nk] ${what} failed: ${String(error)}`)
  }
}

/**
 * Wraps `manager.refresh()` of every runner so that `onRefreshed(runner)` runs
 * after the refresh settles (resolve or reject). This covers every refresh
 * path (the refreshLibrary IPC handler, manager init(), readConfig, ...).
 * The original result / rejection is passed through unchanged.
 *
 * Returns the runners that were wrapped. A missing or changed target logs a
 * single warning and is left untouched.
 */
export function wrapLibraryRefresh(
  managers: Partial<Record<Runner, unknown>>,
  onRefreshed: (runner: Runner) => void,
  warn: (msg: string) => void
): Runner[] {
  const wrapped: Runner[] = []
  const skipped: Runner[] = []
  for (const runner of ALL_RUNNERS) {
    const manager = managers[runner] as Record<string, unknown> | undefined
    const original = manager?.refresh
    if (!manager || !isFn(original)) {
      skipped.push(runner)
      continue
    }
    if (original[WRAPPED]) {
      wrapped.push(runner)
      continue
    }
    const replacement: AnyFn = async function (
      this: unknown,
      ...args: unknown[]
    ) {
      try {
        return await original.apply(this, args)
      } finally {
        safely(() => onRefreshed(runner), warn, `library dates (${runner})`)
      }
    }
    replacement[WRAPPED] = true
    manager.refresh = replacement
    wrapped.push(runner)
  }
  if (skipped.length) {
    warn(
      `[nk] library dates: refresh() not found on ${skipped.join(', ')}; date sort may miss new games there`
    )
  }
  return wrapped
}

/**
 * Wraps the GOG manager's (private) `getGalaxyLibrary(page_token?)` so the
 * complete Galaxy list (top-level call, non-empty: upstream returns [] when
 * any page fails) is handed to `onEntries`. Pagination recursion passes a
 * page token and is ignored.
 */
export function wrapGalaxyLibraryFetch(
  gogManager: unknown,
  onEntries: (entries: unknown[]) => void,
  warn: (msg: string) => void
): boolean {
  const manager = gogManager as Record<string, unknown> | undefined
  const original = manager?.getGalaxyLibrary
  if (!manager || !isFn(original) || original.length > 1) {
    warn(
      '[nk] library dates: GOG getGalaxyLibrary(page_token?) not found or changed; GOG games fall back to first-seen dates'
    )
    return false
  }
  if (original[WRAPPED]) return true
  const replacement: AnyFn = async function (
    this: unknown,
    ...args: unknown[]
  ) {
    const result = await original.apply(this, args)
    if (args[0] === undefined && Array.isArray(result) && result.length) {
      safely(() => onEntries(result), warn, 'GOG Galaxy dates')
    }
    return result
  }
  replacement[WRAPPED] = true
  manager.getGalaxyLibrary = replacement
  return true
}
