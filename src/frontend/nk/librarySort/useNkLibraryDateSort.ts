// nk: #3 - single hook used by Library/index.tsx: returns a function that
// applies the date-added sort (or passes the list through in title mode).
import { useCallback, useContext } from 'react'
import ContextProvider from 'frontend/state/ContextProvider'
import type { GameInfo } from 'common/types'
import { sortGamesByDateAdded } from 'common/nk/librarySort'
import { useLibrarySortPrefs } from './prefs'
import { useLibraryDates } from './useLibraryDates'

export function useNkLibraryDateSort(): (games: GameInfo[]) => GameInfo[] {
  const { epic, gog, amazon, zoom, sideloadedLibrary } =
    useContext(ContextProvider)
  const sortBy = useLibrarySortPrefs((s) => s.sortBy)
  const dates = useLibraryDates(
    epic.library,
    gog.library,
    amazon.library,
    zoom.library,
    sideloadedLibrary,
    sortBy === 'dateAdded' // skip reading the dates file in title mode
  )
  const newestFirst = useLibrarySortPrefs((s) => s.dateNewestFirst)

  return useCallback(
    (games: GameInfo[]) =>
      sortBy === 'dateAdded'
        ? sortGamesByDateAdded(games, dates, newestFirst)
        : games,
    [sortBy, newestFirst, dates]
  )
}
