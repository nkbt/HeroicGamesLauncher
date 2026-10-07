// nk: #3 - fork-owned types for the "date added to library" sort.
import type { Runner } from 'common/types'

export type LibraryDateSource =
  | 'epic-entitlement'
  | 'gog-galaxy'
  | 'amazon-entitlement'
  | 'first-seen'
  | 'seed'

export interface LibraryDateEntry {
  /** epoch milliseconds */
  added: number
  source: LibraryDateSource
}

export interface LibraryDatesFile {
  version: 1
  /** keyed by `${app_name}_${runner}` (see libraryDateKey) */
  dates: Record<string, LibraryDateEntry>
  initializedRunners: Partial<Record<Runner, true>>
}

export const libraryDateKey = (appName: string, runner: Runner) =>
  `${appName}_${runner}`

/**
 * Lives under `store/` (not `store_cache/`): first-seen timestamps cannot be
 * recovered, so the file must survive "Clear cache".
 */
export const LIBRARY_DATES_STORE = { cwd: 'store', name: 'library-dates' }
