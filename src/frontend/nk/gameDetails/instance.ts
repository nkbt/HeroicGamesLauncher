// nk: #5 - the app-wide game details cache. Created when this module is
// first imported (hasStatus imports it, so at startup): hydrates from
// IndexedDB and listens to game status events for the life of the renderer.
import i18next from 'i18next'
import type { GameInfo, Runner } from 'common/types'
import { getInstallInfo } from 'frontend/helpers'
import { createGameDetailsApi, type DetailsIpc } from './api'
import { type Libraries, indexLibraries, removedGames } from './librarySync'
import { IndexedDbPersistence, MemoryPersistence } from './persistence'
import { createGameDetailsStore } from './store'
import { createLocalEvents } from './localEvents'
import { createStatusTracker } from './statusInvalidation'
import { forgetStatus, rememberStatus, statusRefreshed } from './statusMemo'
import { detailsKey, type DetailsKey } from './types'
import { listenToResetGameDetails } from './reset'
import { createDetailsConnectivity } from './connectivity'

export const gameDetailsStore = createGameDetailsStore(
  typeof indexedDB === 'undefined'
    ? new MemoryPersistence()
    : new IndexedDbPersistence(indexedDB),
  {
    scheduleNotify: (notify) =>
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(notify)
        : setTimeout(notify, 0)
  }
)

const detailsConnectivity = createDetailsConnectivity(() => {
  void localEvents.reconnect()
})

let libraryGames = new Map<DetailsKey, GameInfo>()

/** The game's current library list entry, if the library is loaded. */
export function getLibraryGame(runner: Runner, appName: string) {
  return libraryGames.get(detailsKey(runner, appName))
}

export const gameDetailsApi = createGameDetailsApi(gameDetailsStore, {
  ipc: () => window.api as unknown as DetailsIpc,
  getInstallInfo,
  platform: window.platform,
  getLanguage: () => i18next.language ?? '',
  isOnline: detailsConnectivity.isOnline,
  getLibraryGame
})

/**
 * The library lists changed: remember every game's list entry and drop the
 * cached details of games no longer in a loaded store library.
 */
export function syncLibraries(libraries: Libraries) {
  libraryGames = indexLibraries(libraries)
  for (const [key, gameInfo] of libraryGames) {
    const entry = gameDetailsStore.getEntry(key)
    if (entry && entry.gameInfo !== gameInfo)
      gameDetailsStore.patchEntry(key, (entry) => ({ ...entry, gameInfo }))
  }
  if (!gameDetailsStore.isHydrated()) return
  const removed = removedGames(gameDetailsStore.keys(), libraries, libraryGames)
  if (removed.length) gameDetailsStore.removeKeys(removed)
}

/** Refresh checks availability and tells this game's status consumers. */
export async function refreshStatus(
  gameInfo: GameInfo,
  current: () => boolean
) {
  const { app_name: appName, runner } = gameInfo
  const generation = gameDetailsStore.generation()
  const key = detailsKey(runner, appName)
  const version = gameDetailsStore.version(key)
  forgetStatus(appName)
  if (gameInfo.is_installed && !gameInfo.thirdPartyManagedApp) {
    const available = await window.api.isGameAvailable({ appName, runner })
    if (
      !current() ||
      gameDetailsStore.generation() !== generation ||
      gameDetailsStore.version(key) !== version
    )
      return
    rememberStatus(appName, {
      status: available ? 'installed' : 'notAvailable'
    })
  }
  if (current()) statusRefreshed(appName)
}

/** The user's "Clear Heroic cache": empties the renderer details cache too. */
export function clearCaches(showDialog?: boolean) {
  void gameDetailsStore.clearAll().catch(() => undefined)
  window.api.clearCache(showDialog)
}

const localEvents = createLocalEvents({
  gameDetailsApi,
  store: gameDetailsStore,
  invalidateGameDetailsCaches: async (request) =>
    window.api.invalidateGameDetailsCaches(request),
  isOnline: detailsConnectivity.isOnline
})

if (typeof window.api.handleResetGameDetails === 'function')
  listenToResetGameDetails(gameDetailsStore, window.api)

function listenToGameStatus() {
  const track = createStatusTracker()
  const operations = new Map<
    DetailsKey,
    { runner: Runner; appName: string; generation: number; version: number }
  >()
  window.api.handleGameStatus?.((_e, status) => {
    const matching = status.runner
      ? []
      : [...operations.values()].filter(
          (operation) => operation.appName === status.appName
        )
    const runner =
      status.runner ?? (matching.length === 1 ? matching[0].runner : undefined)
    if (!runner) return
    const key = detailsKey(runner, status.appName)
    const operation = operations.get(key)
    const action = track({ ...status, runner })
    if (
      !operation &&
      status.runner !== undefined &&
      (status.status === 'installing' ||
        status.status === 'updating' ||
        status.status === 'repairing' ||
        status.status === 'moving' ||
        status.status === 'uninstalling' ||
        status.status === 'importing' ||
        status.status === 'extracting' ||
        status.status === 'playing')
    ) {
      operations.set(key, {
        runner,
        appName: status.appName,
        generation: gameDetailsStore.generation(),
        version: gameDetailsStore.version(key)
      })
    } else if (
      (status.status === 'done' || status.status === 'error') &&
      operation?.runner === runner
    ) {
      operations.delete(key)
    }
    if (
      !action ||
      !operation ||
      operation.generation !== gameDetailsStore.generation() ||
      operation.version !== gameDetailsStore.version(key)
    )
      return
    if (action === 'installChanged') {
      void localEvents.installChanged(status.appName, runner)
    } else {
      void localEvents.played(status.appName, runner)
    }
  })
}

// development builds (dev server origin): IPC counters for acceptance checks
if (window.location?.protocol && window.location.protocol !== 'file:') {
  Object.assign(window, { __nkGameDetails: { stats: gameDetailsApi.stats } })
}

detailsConnectivity.listen(window.api)
void gameDetailsStore.hydrate().then(() => localEvents.reconnect())
listenToGameStatus()
