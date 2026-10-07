// nk: #5 - mounts the wrapped game page once per game: navigating from one
// game page to another (search bar) keeps the same route element, and
// without a key the page kept the previous game's state.
import type { ComponentType } from 'react'
import { useParams } from 'react-router-dom'
import { useStore } from 'zustand'
import { gameDetailsStore } from './instance'
import { useRouteGameInfo } from './route'

export function keyedByGame<P extends object>(Inner: ComponentType<P>) {
  function KeyedByGame(props: P) {
    const { appName, runner } = useParams()
    const hydrated = useStore(gameDetailsStore.state, (state) => state.hydrated)
    const gameInfo = useRouteGameInfo()
    if (!hydrated || !gameInfo) return null
    return <Inner key={`${runner}:${appName}`} {...props} />
  }
  return KeyedByGame
}
