// nk: #3 - library sort preferences (module-level, survives Library remounts).
import { create } from 'zustand'

export type LibrarySortBy = 'title' | 'dateAdded'

export const SORT_BY_KEY = 'nk.librarySortBy'
export const DATE_NEWEST_FIRST_KEY = 'nk.libraryDateNewestFirst'

interface LibrarySortPrefsState {
  sortBy: LibrarySortBy
  dateNewestFirst: boolean
  setSortBy: (sortBy: LibrarySortBy) => void
  setDateNewestFirst: (newestFirst: boolean) => void
}

function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore: preference just won't persist
  }
}

// Default: date added, newest first
const initialSortBy: LibrarySortBy =
  readItem(SORT_BY_KEY) === 'title' ? 'title' : 'dateAdded'
const initialNewestFirst = readItem(DATE_NEWEST_FIRST_KEY) !== 'false'

export const useLibrarySortPrefs = create<LibrarySortPrefsState>()((set) => ({
  sortBy: initialSortBy,
  dateNewestFirst: initialNewestFirst,
  setSortBy: (sortBy) => {
    writeItem(SORT_BY_KEY, sortBy)
    set({ sortBy })
  },
  setDateNewestFirst: (dateNewestFirst) => {
    writeItem(DATE_NEWEST_FIRST_KEY, String(dateNewestFirst))
    set({ dateNewestFirst })
  }
}))

/** true when the library is sorted by date added */
export const useNkDateSortActive = () =>
  useLibrarySortPrefs((s) => s.sortBy === 'dateAdded')
