// nk: #5 - direct route identity stays separate from the card/status hooks.
import { useContext } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useStore } from 'zustand'
import type { GameInfo } from 'common/types'
import ContextProvider from 'frontend/state/ContextProvider'
import { gameDetailsStore } from './instance'
import { detailsKey } from './types'

/** Resolve direct game routes from the shared library and persisted game entry. */
export function useRouteGameInfo(): GameInfo | undefined {
  const { appName, runner } = useParams()
  const location = useLocation()
  const { epic, gog, amazon, zoom, sideloadedLibrary } =
    useContext(ContextProvider)
  const key = detailsKey(runner ?? '', appName ?? '')
  const cached = useStore(
    gameDetailsStore.state,
    (state) => state.entries[key]?.gameInfo
  )
  const current = gameDetailsStore.getEntry(key)?.gameInfo ?? cached
  const locationGameInfo = (location.state as { gameInfo?: GameInfo } | null)
    ?.gameInfo
  if (
    locationGameInfo &&
    locationGameInfo.app_name === appName &&
    locationGameInfo.runner === runner
  )
    return locationGameInfo
  let library: GameInfo[] = []
  switch (runner) {
    case 'legendary':
      library = epic.library
      break
    case 'gog':
      library = gog.library
      break
    case 'nile':
      library = amazon.library
      break
    case 'zoom':
      library = zoom.library
      break
    case 'sideload':
      library = sideloadedLibrary
      break
  }
  return library.find((gameInfo) => gameInfo.app_name === appName) ?? current
}
