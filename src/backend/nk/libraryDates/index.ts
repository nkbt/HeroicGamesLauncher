// nk: #3 - I/O and wiring for the library-dates side store
// (~/.config/heroic/store/library-dates.json).
import Store from 'electron-store'
import { readFileSync } from 'graceful-fs'
import { join } from 'path'

import { logInfo, logWarning, LogPrefix } from 'backend/logger'
import { libraryManagerMap } from 'backend/storeManagers'
import { legendaryConfigPath } from 'backend/storeManagers/legendary/constants'
import { nileLibrary } from 'backend/storeManagers/nile/constants'
import { libraryStore as legendaryLibraryStore } from 'backend/storeManagers/legendary/electronStores'
import { libraryStore as gogLibraryStore } from 'backend/storeManagers/gog/electronStores'
import { libraryStore as nileLibraryStore } from 'backend/storeManagers/nile/electronStores'
import { libraryStore as sideloadLibraryStore } from 'backend/storeManagers/sideload/electronStores'
import { libraryStore as zoomLibraryStore } from 'backend/storeManagers/zoom/electronStores'

import type { GameInfo, Runner } from 'common/types'
import {
  LIBRARY_DATES_STORE,
  type LibraryDatesFile
} from 'common/types/nk/libraryDates'
import {
  amazonDates,
  computeLibraryDates,
  epicNamespaceDates,
  gogGalaxyDates,
  mergeStoreDates,
  sanitiseLibraryDates,
  type LibraryDatesInput
} from './compute'
import {
  ALL_RUNNERS,
  wrapGalaxyLibraryFetch,
  wrapLibraryRefresh
} from './hooks'

export { computeLibraryDates } from './compute'

const prefix = LogPrefix.Backend

let store: Store<LibraryDatesFile> | undefined
function getStore() {
  if (!store) {
    store = new Store<LibraryDatesFile>({
      ...LIBRARY_DATES_STORE,
      clearInvalidConfig: true,
      // Amazon app names contain dots; never treat keys as paths
      accessPropertiesByDotNotation: false
    })
  }
  return store
}

function readFile(): LibraryDatesFile {
  return sanitiseLibraryDates(getStore().store)
}

function writeFile(next: LibraryDatesFile) {
  // always written as a whole object (never `set('dates.<key>')`)
  getStore().store = next
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return undefined
  }
}

function gamesFor(runner: Runner): GameInfo[] {
  switch (runner) {
    case 'legendary':
      return legendaryLibraryStore.get('library', [])
    case 'gog':
      return gogLibraryStore.get('games', [])
    case 'nile':
      return nileLibraryStore.get('library', [])
    case 'sideload':
      return sideloadLibraryStore.get('games', [])
    case 'zoom':
      return zoomLibraryStore.get('games', [])
  }
}

let warnedNoEpicEntitlements = false

function storeDatesFor(runner: Runner, games: GameInfo[], now: number) {
  if (runner === 'legendary') {
    const json = readJson(join(legendaryConfigPath, 'entitlements.json'))
    const { dates, activeEntitlements } = epicNamespaceDates(json, games, now)
    if (activeEntitlements === 0 && games.length > 0) {
      if (!warnedNoEpicEntitlements) {
        warnedNoEpicEntitlements = true
        logWarning(
          '[nk] library dates: legendary entitlements.json has no ACTIVE entries while the Epic library is not empty; Epic games fall back to first-seen dates',
          prefix
        )
      }
    }
    return dates
  }
  if (runner === 'nile') {
    return amazonDates(readJson(nileLibrary), now)
  }
  // GOG dates are recorded from the Galaxy response (recordGogGalaxyDates)
  return new Map<string, number>()
}

/**
 * Synchronous (cannot interleave with other main-process work). Never throws.
 */
export function updateLibraryDates(library?: Runner | 'all') {
  try {
    const runners =
      library && library !== 'all' && ALL_RUNNERS.includes(library)
        ? [library]
        : ALL_RUNNERS
    const now = Date.now()
    const inputs: LibraryDatesInput[] = runners.map((runner) => {
      const games = gamesFor(runner) ?? []
      return { runner, games, storeDates: storeDatesFor(runner, games, now) }
    })
    const { next, changed, changedCount } = computeLibraryDates(
      readFile(),
      inputs,
      now
    )
    if (changed) {
      writeFile(next)
      logInfo(
        `[nk] library dates updated (${runners.join(', ')}): ${changedCount} change(s), ${Object.keys(next.dates).length} entries`,
        prefix
      )
    }
  } catch (error) {
    logWarning(['[nk] library dates update failed', String(error)], prefix)
  }
}

export function recordGogGalaxyDates(entries: unknown[]) {
  try {
    const { next, changed, changedCount } = mergeStoreDates(
      readFile(),
      'gog',
      gogGalaxyDates(entries)
    )
    if (changed) {
      writeFile(next)
      logInfo(`[nk] GOG Galaxy dates: ${changedCount} change(s)`, prefix)
    }
  } catch (error) {
    logWarning(
      ['[nk] recording GOG Galaxy dates failed', String(error)],
      prefix
    )
  }
}

/** Called once from initNk(). */
export function initLibraryDates() {
  const warn = (msg: string) => logWarning(msg, prefix)
  wrapLibraryRefresh(libraryManagerMap, updateLibraryDates, warn)
  wrapGalaxyLibraryFetch(libraryManagerMap.gog, recordGogGalaxyDates, warn)
  // Record the sideload state once at startup (local file, cheap). An empty
  // sideload library is marked initialized here, so the first app the user
  // adds is first-seen = now even if no refresh ran before it.
  updateLibraryDates('sideload')
}
