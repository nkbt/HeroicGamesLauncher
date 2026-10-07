// nk: #3 - reads the backend-maintained library-dates side store.
import { useMemo } from 'react'
import type { GameInfo } from 'common/types'
import {
  LIBRARY_DATES_STORE,
  type LibraryDateEntry
} from 'common/types/nk/libraryDates'

const STORE_NAME = 'nkLibraryDates'

let storeReady = false
function ensureStore() {
  if (storeReady) return true
  try {
    window.api.storeNew(STORE_NAME, {
      ...LIBRARY_DATES_STORE,
      accessPropertiesByDotNotation: false
    })
    storeReady = true
  } catch {
    storeReady = false
  }
  return storeReady
}
ensureStore()

export function readLibraryDates(): Record<string, LibraryDateEntry> {
  if (!ensureStore()) return {}
  try {
    const dates = window.api.storeGet(STORE_NAME, 'dates', {})
    return dates && typeof dates === 'object'
      ? (dates as Record<string, LibraryDateEntry>)
      : {}
  } catch {
    return {}
  }
}

const NO_DATES: Record<string, LibraryDateEntry> = Object.freeze({})

/**
 * Library dates keyed by `${app_name}_${runner}`. Re-read whenever one of the
 * library arrays changes identity (every refresh writes the file before the
 * renderer reloads its arrays). With `enabled = false` nothing is read and an
 * empty object is returned (title mode does not need the dates).
 */
export function useLibraryDates(
  epicLib: GameInfo[],
  gogLib: GameInfo[],
  amazonLib: GameInfo[],
  zoomLib: GameInfo[],
  sideloadLib: GameInfo[],
  enabled = true
): Record<string, LibraryDateEntry> {
  return useMemo(
    () => (enabled ? readLibraryDates() : NO_DATES),
    // the arrays are only re-read triggers (identity changes after refresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, epicLib, gogLib, amazonLib, zoomLib, sideloadLib]
  )
}
