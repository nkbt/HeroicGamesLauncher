// nk: #5 - backend side of the game details cache. Called from initNk().
// - getWikiGameInfo: in-flight dedupe, all-empty results are not persisted
// - GOG getExtraInfo: persistent cache (upstream has none)
// - `invalidateGameDetailsCaches` IPC: drops one game's backend detail
//   caches (game page Refresh, finished installs)
// Every piece checks its target and logs one `[nk]` warning (upstream
// behaviour kept) when the target changed shape.
// eslint-disable-next-line no-restricted-imports
import { ipcMain } from 'electron'
import i18next from 'i18next'
import CacheStore from 'backend/cache'
import { addHandler, addListener } from 'backend/ipc'
import { logInfo, logWarning, LogPrefix } from 'backend/logger'
import { isOnline } from 'backend/online_monitor'
import { getGame, removeSpecialcharacters } from 'backend/utils'
import { getWikiGameInfo } from 'backend/wiki_game_info/wiki_game_info'
import {
  umuStore,
  wikiGameInfoStore
} from 'backend/wiki_game_info/electronStore'
import GOGGame from 'backend/storeManagers/gog/games'
import {
  achievementStore as gogAchievementStore,
  installInfoStore as gogInstallInfoStore
} from 'backend/storeManagers/gog/electronStores'
import {
  gameInfoStore as legendaryGameInfoStore,
  installStore as legendaryInstallStore
} from 'backend/storeManagers/legendary/electronStores'
import { installStore as nileInstallStore } from 'backend/storeManagers/nile/electronStores'
import { installInfoStore as zoomInstallStore } from 'backend/storeManagers/zoom/electronStores'
import type {
  InvalidateGameDetailsRequest,
  InvalidateGameDetailsResult
} from 'common/types/nk/gameDetails'
import type { ExtraInfo, Runner, WikiInfo } from 'common/types'
import { refreshImages } from '../imageCache'
import { guardStoreSet, isEmptyWikiInfo, replaceIpcHandler } from './wikiInfo'
import { wrapGogGetExtraInfo } from './gogExtraInfoCache'
import { invalidateBackendCaches } from './invalidate'
import { requestBarrier, trackDetailsHandler } from './requestBarrier'

import { wikiInflight } from './dedupeWiki'
import { guardResetHeroic } from './reset'
import { getMainWindow } from 'backend/main_window'
import { publicDir } from 'backend/constants/paths'
import { join } from 'path'
import { pathToFileURL } from 'url'
let trackedHandlers = false

const warn = (msg: string) => logWarning(msg, LogPrefix.Backend)

// never expires: one game's entries are dropped by the invalidation IPC
const gogExtraInfoStore = new CacheStore<ExtraInfo>('nk_gog_extra_info', null)

function initWikiHardening() {
  guardStoreSet<WikiInfo>(wikiGameInfoStore, isEmptyWikiInfo, warn)

  replaceIpcHandler(
    ipcMain,
    'getWikiGameInfo',
    (async (_e: unknown, _title: string, appName: string, runner: Runner) => {
      const game = getGame(appName, runner)
      return getWikiGameInfo(game)
    }) as never,
    warn
  )
}

function initGogExtraInfoCache() {
  wrapGogGetExtraInfo(GOGGame.prototype, {
    store: gogExtraInfoStore,
    getLanguage: () => i18next.language ?? '',
    isOnline,
    warn
  })
  // "Clear Heroic cache" empties it; a version-change wipe keeps it (fork
  // caches never expire)
  addListener('clearCache', (_e, _showDialog, fromVersionChange) => {
    if (!fromVersionChange) gogExtraInfoStore.clear()
  })
}

async function invalidateGameDetails({
  appName,
  runner,
  scope,
  artUrls
}: InvalidateGameDetailsRequest): Promise<InvalidateGameDetailsResult> {
  let wikiTitle: string | undefined
  let namespace: string | undefined
  try {
    // resolved here, so title overrides and renderer state do not matter
    const info = getGame(appName, runner).getGameInfo()
    wikiTitle = removeSpecialcharacters(info.title)
    namespace = info.namespace ?? undefined
  } catch (error) {
    warn(`[nk] game details: unknown game ${appName}: ${String(error)}`)
  }

  if ((scope === 'all' || scope === 'meta') && wikiTitle) {
    await wikiInflight.wait(wikiTitle)
  }

  if (!trackedHandlers) {
    return {
      dropped: [],
      failed: ['pending-detail-requests'],
      art: { refreshed: 0, failed: 0 }
    }
  }

  const { dropped, failed } = invalidateBackendCaches(
    { appName, runner, wikiTitle, namespace },
    scope,
    {
      wikiGameInfo: wikiGameInfoStore,
      umu: umuStore,
      legendaryGameInfo: legendaryGameInfoStore,
      legendaryInstallInfo: legendaryInstallStore,
      gogExtraInfo: gogExtraInfoStore,
      gogAchievements: gogAchievementStore,
      gogInstallInfo: gogInstallInfoStore,
      nileInstallInfo: nileInstallStore,
      zoomInstallInfo: zoomInstallStore
    },
    warn
  )
  const art =
    scope === 'all' && artUrls?.length && isOnline()
      ? await refreshImages(artUrls)
      : { refreshed: 0, failed: 0 }
  logInfo(
    `[nk] game details (${scope}) of ${appName}: dropped ${dropped.length}, failed ${failed.length}, art ${art.refreshed} refreshed / ${art.failed} failed`,
    LogPrefix.Backend
  )
  return { dropped, failed, art }
}

export function initGameDetails() {
  guardResetHeroic(ipcMain as never, warn, {
    getMainWindow,
    rendererEntry:
      process.env.ELECTRON_RENDERER_URL ||
      pathToFileURL(join(publicDir, 'index.html')).href
  })
  try {
    initWikiHardening()
  } catch (error) {
    warn(`[nk] game details: wiki init failed: ${String(error)}`)
  }

  try {
    initGogExtraInfoCache()
  } catch (error) {
    warn(`[nk] game details: GOG extra info init failed: ${String(error)}`)
  }

  const extraInfo = trackDetailsHandler(
    ipcMain as never,
    'getExtraInfo',
    requestBarrier,
    warn
  )
  const installInfo = trackDetailsHandler(
    ipcMain as never,
    'getInstallInfo',
    requestBarrier,
    warn
  )
  const launchOptions = trackDetailsHandler(
    ipcMain as never,
    'getLaunchOptions',
    requestBarrier,
    warn
  )
  const achievements = trackDetailsHandler(
    ipcMain as never,
    'getAchievements',
    requestBarrier,
    warn
  )
  trackedHandlers = extraInfo && installInfo && launchOptions && achievements
  addHandler('invalidateGameDetailsCaches', async (_e, request) =>
    requestBarrier.invalidate(
      `${request.runner}:${request.appName}`,
      async () => invalidateGameDetails(request)
    )
  )
}
