// nk: #4 - asks the backend to download every library card image that is not
// on disk yet (all stores, hidden and filtered-out games included), so
// scrolling, filtering or opening the app offline never waits on the network.
// Mounted once from App.tsx `Root`.
// - On mount and on every return to online, the complete current list is sent
//   once. The backend skips cached files and URLs already queued, so this
//   downloads nothing that is on disk, and it replaces any list the backend
//   deferred while offline (it keeps only the latest list per tier).
// - Between connectivity changes, a library change (debounced) sends only URLs
//   not sent before: an unchanged or reordered library sends nothing, one
//   changed cover sends only its new URL.
// - While offline nothing is sent.
import { useContext, useEffect, useMemo, useRef } from 'react'
import ContextProvider from 'frontend/state/ContextProvider'
import {
  getLibraryCardImageUrls,
  orderForPrefetch,
  takeUnsentUrls
} from './libraryImageUrls'

const DEBOUNCE_MS = 1500

export function useLibraryImagePrefetch() {
  const {
    epic,
    gog,
    amazon,
    zoom,
    sideloadedLibrary,
    favouriteGames,
    connectivity
  } = useContext(ContextProvider)
  const online = connectivity.status === 'online'
  // sent, or in a request that has not answered yet
  const sent = useRef(new Set<string>())
  // the next call sends the complete list (on mount and after being offline)
  const sendAll = useRef(true)

  const urls = useMemo(() => {
    const favourites = new Set(favouriteGames.list.map((f) => f.appName))
    const games = [
      ...epic.library,
      ...gog.library,
      ...amazon.library,
      ...zoom.library,
      ...sideloadedLibrary
    ]
    return getLibraryCardImageUrls(orderForPrefetch(games, favourites))
  }, [
    epic.library,
    gog.library,
    amazon.library,
    zoom.library,
    sideloadedLibrary,
    favouriteGames.list
  ])

  useEffect(() => {
    if (!online) sendAll.current = true
  }, [online])

  useEffect(() => {
    if (!online) return
    if (!sendAll.current && urls.every((url) => sent.current.has(url))) return
    const timer = setTimeout(() => {
      const prefetch = window.api.prefetchLibraryImages
      if (typeof prefetch !== 'function') return
      let urlsToSend: string[]
      if (sendAll.current) {
        sendAll.current = false
        sent.current = new Set(urls)
        urlsToSend = urls
      } else {
        urlsToSend = takeUnsentUrls(sent.current, urls)
      }
      if (!urlsToSend.length) return
      prefetch(urlsToSend, 'card').catch((error: unknown) => {
        // not delivered: send these again with the next change
        for (const url of urlsToSend) sent.current.delete(url)
        console.warn('[nk] library image prefetch failed', error)
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [urls, online])
}
