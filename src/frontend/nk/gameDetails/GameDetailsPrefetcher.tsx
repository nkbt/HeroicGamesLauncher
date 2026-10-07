// nk: #5 - one null-rendering owner of background and delegated card intents.
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import ContextProvider from 'frontend/state/ContextProvider'
import { configStore } from 'frontend/helpers/electronStores'
import { sortGamesByDateAdded } from 'common/nk/librarySort'
import { useLibraryDates } from 'frontend/nk/librarySort/useLibraryDates'
import type { GameInfo, Runner } from 'common/types'
import { useLibrarySync } from './hooks'
import {
  gameDetailsPrefetch,
  gameDetailsReconciliation,
  gameDetailsScheduler,
  gameDetailsStore,
  getLibraryGame
} from './instance'
import { detailsKey } from './types'
import { gamePageArtUrls } from './imageUrls'
import { warmDetailsArt } from './art'

let startupDeadline: number | undefined
let startupComplete = false
let lastLanguage: string | undefined
const sentArt = new Set<string>()
export function detailsPrefetchEnabled() {
  return localStorage.getItem('nk.prefetchGameDetails') !== 'false'
}

export default function GameDetailsPrefetcher() {
  useLibrarySync()
  const [enabled, setEnabled] = useState(detailsPrefetchEnabled)
  const {
    epic,
    gog,
    amazon,
    zoom,
    sideloadedLibrary,
    favouriteGames,
    hiddenGames,
    libraryStatus,
    connectivity,
    refreshing,
    language
  } = useContext(ContextProvider)
  const hydrated = useStore(gameDetailsStore.state, (state) => state.hydrated)
  const dates = useLibraryDates(
    epic.library,
    gog.library,
    amazon.library,
    zoom.library,
    sideloadedLibrary
  )
  const selected = useRef(language)
  selected.current = language
  const games = useMemo(() => {
    const favourites = new Set(favouriteGames.list.map((game) => game.appName))
    const hidden = new Set(hiddenGames.list.map((game) => game.appName))
    const recent = new Set(
      configStore.get('games.recent', []).map((game) => game.appName)
    )
    const ordered = sortGamesByDateAdded(
      [
        ...epic.library,
        ...gog.library,
        ...amazon.library,
        ...zoom.library,
        ...sideloadedLibrary
      ].filter((game) => !game.install?.is_dlc),
      dates,
      true
    )
    const rank = (game: GameInfo) =>
      hidden.has(game.app_name)
        ? 4
        : game.is_installed
          ? 0
          : favourites.has(game.app_name)
            ? 1
            : recent.has(game.app_name)
              ? 2
              : 3
    return ordered.sort((a, b) => rank(a) - rank(b))
  }, [
    epic.library,
    gog.library,
    amazon.library,
    zoom.library,
    sideloadedLibrary,
    favouriteGames.list,
    hiddenGames.list,
    dates
  ])

  useEffect(() => {
    gameDetailsScheduler.update({
      playing: libraryStatus.some((game) => game.status === 'playing'),
      launching: libraryStatus.some((game) => game.status === 'launching'),
      downloading: libraryStatus.some(
        (game) =>
          game.status === 'installing' ||
          game.status === 'updating' ||
          game.status === 'repairing' ||
          game.status === 'extracting'
      ),
      refreshing,
      enabled: detailsPrefetchEnabled()
    })
  }, [libraryStatus, refreshing, connectivity.status])

  useEffect(() => {
    setEnabled(detailsPrefetchEnabled())
    if (!hydrated || refreshing || !games.length || !detailsPrefetchEnabled())
      return
    if (startupDeadline === undefined) startupDeadline = Date.now() + 10000
    const timer = setTimeout(
      () => {
        if (!detailsPrefetchEnabled()) {
          setEnabled(false)
          gameDetailsScheduler.update({ enabled: false })
          return
        }
        const languageOnly =
          startupComplete &&
          lastLanguage !== undefined &&
          lastLanguage !== selected.current
        for (const gameInfo of games) {
          gameDetailsReconciliation.observe(gameInfo)
          void gameDetailsPrefetch.prefetch(gameInfo, 2, languageOnly)
        }
        startupComplete = true
        lastLanguage = selected.current
      },
      startupComplete ? 0 : Math.max(0, startupDeadline - Date.now())
    )
    return () => clearTimeout(timer)
  }, [games, hydrated, refreshing, language, connectivity.status, enabled])

  useEffect(() => {
    if (
      !hydrated ||
      refreshing ||
      connectivity.status !== 'online' ||
      !detailsPrefetchEnabled()
    )
      return
    const urls: string[] = []
    for (const gameInfo of games)
      for (const src of gamePageArtUrls(gameInfo))
        if (!sentArt.has(src)) {
          sentArt.add(src)
          urls.push(src)
        }
    if (urls.length)
      void gameDetailsScheduler
        .enqueue(
          {
            id: `details-art|${urls.join('|')}`,
            key: 'details-art',
            lane: 'storeApi',
            network: true,
            priority: 2
          },
          () => window.api.prefetchLibraryImages(urls, 'details')
        )
        .catch(() => {
          for (const src of urls) sentArt.delete(src)
        })
  }, [games, hydrated, refreshing, connectivity.status, enabled])

  useEffect(() => {
    const storage = () => {
      setEnabled(detailsPrefetchEnabled())
      gameDetailsScheduler.update({ enabled: detailsPrefetchEnabled() })
    }
    window.addEventListener('storage', storage)
    return () => window.removeEventListener('storage', storage)
  }, [])
  useEffect(() => {
    if (!enabled) return
    const owners = new Map<'pointer' | 'focus', string>()
    const timers = new Map<'pointer' | 'focus', ReturnType<typeof setTimeout>>()
    const intents: string[] = []
    function gameOf(target: EventTarget | null) {
      if (!(target instanceof Element)) return
      const card = target.closest('[data-app-name]')
      if (!card) return
      const appName = card.getAttribute('data-app-name')
      const link =
        card.querySelector('a[href*="/gamepage/"]') ??
        card.closest('a[href*="/gamepage/"]')
      const route = link
        ?.getAttribute('href')
        ?.match(/\/gamepage\/([^/]+)\/([^/?#]+)/)
      if (!appName || !route || decodeURIComponent(route[2]) !== appName) return
      return getLibraryGame(decodeURIComponent(route[1]) as Runner, appName)
    }
    function enter(event: Event, owner: 'pointer' | 'focus') {
      const gameInfo = gameOf(event.target)
      if (!gameInfo || !detailsPrefetchEnabled()) {
        setEnabled(detailsPrefetchEnabled())
        gameDetailsScheduler.update({ enabled: detailsPrefetchEnabled() })
        return
      }
      const key = detailsKey(gameInfo.runner, gameInfo.app_name)
      if (owners.get(owner) === key) return
      leave(owner)
      owners.set(owner, key)
      gameDetailsScheduler.update({ enabled: true })
      timers.set(
        owner,
        setTimeout(() => {
          timers.delete(owner)
          const old = intents.indexOf(key)
          if (old !== -1) intents.splice(old, 1)
          intents.unshift(key)
          if (intents.length > 3) gameDetailsScheduler.downgrade(intents.pop()!)
          void gameDetailsPrefetch.prefetch(gameInfo, 1)
          void gameDetailsScheduler
            .enqueue(
              {
                id: `${key}|art`,
                key,
                lane: 'local',
                network: true,
                priority: 1
              },
              () => warmDetailsArt(gameInfo)
            )
            .catch(() => undefined)
        }, 150)
      )
    }
    function leave(owner: 'pointer' | 'focus') {
      const timer = timers.get(owner)
      if (timer !== undefined) clearTimeout(timer)
      timers.delete(owner)
      const key = owners.get(owner)
      owners.delete(owner)
      if (key && ![...owners.values()].includes(key))
        gameDetailsScheduler.cancel(key, true)
    }
    const pointerOver = (event: Event) => enter(event, 'pointer')
    const focusIn = (event: Event) => enter(event, 'focus')
    const pointerOut = (event: PointerEvent) => {
      if (gameOf(event.target) !== gameOf(event.relatedTarget)) leave('pointer')
    }
    const focusOut = (event: FocusEvent) => {
      if (gameOf(event.target) !== gameOf(event.relatedTarget)) leave('focus')
    }
    document.addEventListener('pointerover', pointerOver)
    document.addEventListener('pointerout', pointerOut)
    document.addEventListener('focusin', focusIn)
    document.addEventListener('focusout', focusOut)
    return () => {
      leave('pointer')
      leave('focus')
      document.removeEventListener('pointerover', pointerOver)
      document.removeEventListener('pointerout', pointerOut)
      document.removeEventListener('focusin', focusIn)
      document.removeEventListener('focusout', focusOut)
      gameDetailsScheduler.update({ enabled: false })
    }
  }, [enabled])
  return null
}
