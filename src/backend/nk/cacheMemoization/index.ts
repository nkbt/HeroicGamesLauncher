// nk: #5 - explicit selected stores; libraries/configuration remain upstream.
import { app } from 'electron'
import { logWarning, LogPrefix } from 'backend/logger'
import { wikiGameInfoStore } from 'backend/wiki_game_info/electronStore'
import {
  apiInfoCache,
  achievementStore,
  installInfoStore as gogInstallInfoStore
} from 'backend/storeManagers/gog/electronStores'
import {
  gameInfoStore,
  installStore as legendaryInstallStore
} from 'backend/storeManagers/legendary/electronStores'
import { installStore as nileInstallStore } from 'backend/storeManagers/nile/electronStores'
import { installInfoStore as zoomInstallInfoStore } from 'backend/storeManagers/zoom/electronStores'
import { flushMemoizedCaches, memoizeCacheStore } from './adapter'
export {
  memoizeCacheStore,
  suppressMemoizedCaches,
  resumeMemoizedCaches
} from './adapter'
let initialized = false
export function initCacheMemoization() {
  if (initialized) return
  initialized = true
  const warn = (message: string) => logWarning(message, LogPrefix.Backend)
  memoizeCacheStore(wikiGameInfoStore, warn)
  memoizeCacheStore(apiInfoCache, warn)
  memoizeCacheStore(achievementStore, warn)
  memoizeCacheStore(gogInstallInfoStore, warn)
  memoizeCacheStore(gameInfoStore, warn)
  memoizeCacheStore(legendaryInstallStore, warn)
  memoizeCacheStore(nileInstallStore, warn)
  memoizeCacheStore(zoomInstallInfoStore, warn)
  app.once('will-quit', () => flushMemoizedCaches(warn))
  process.once('exit', () => flushMemoizedCaches(warn))
}
