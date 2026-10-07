// nk: #5 - the game page Refresh button: re-fetches every cached detail of
// one game, and nothing of any other game. The game's backend detail caches
// are dropped first (fork IPC) and its art is downloaded again; until that
// finished no fetch of this game starts, so upstream's TTL caches cannot
// answer with old data. When the backend could not drop a cache nothing is
// fetched and the Refresh reports a failure. The page keeps showing its data
// meanwhile; each value is replaced in place when it arrives. A failed or
// failure-shaped fetch keeps the old value.
import { createStore } from 'zustand/vanilla'
import type { GameInfo, InstallPlatform } from 'common/types'
import type {
  InvalidateGameDetailsRequest,
  InvalidateGameDetailsResult
} from 'common/types/nk/gameDetails'
import { getLibraryCardImageUrls } from 'frontend/nk/libraryImages/libraryImageUrls'
import type { GameDetailsApi } from './api'
import type { GameDetailsStore } from './store'
import { gamePageArtUrls } from './imageUrls'
import { installPlatformOf, listSigOf, wantsInstallInfo } from './logic'
import {
  detailsKey,
  type DetailsKey,
  extraInfoSlot,
  isExtraInfoSlot,
  isInstallInfoSlot
} from './types'

export interface RefreshProgress {
  done: number
  total: number
  failed: number
}

export interface RefreshDeps {
  gameDetailsApi: GameDetailsApi
  store: GameDetailsStore
  invalidateGameDetailsCaches: (
    request: InvalidateGameDetailsRequest
  ) => Promise<InvalidateGameDetailsResult>
  refreshStatus: (gameInfo: GameInfo, current: () => boolean) => Promise<void>
  platform: string
  /** UI language: the extra info of other languages is dropped */
  language: string
  online: boolean
  warn?: (...args: unknown[]) => void
}

export interface RefreshState {
  /** progress of running refreshes */
  running: Record<DetailsKey, RefreshProgress>
  /** failed step count of the last finished refresh (until the next one) */
  failed: Record<DetailsKey, number>
}

export const refreshState = createStore<RefreshState>(() => ({
  running: {},
  failed: {}
}))

const running = new Map<DetailsKey, Promise<RefreshProgress>>()

function report(
  key: DetailsKey,
  progress: RefreshProgress | null,
  failed?: number
) {
  refreshState.setState((s) => {
    const next = { running: { ...s.running }, failed: { ...s.failed } }
    if (progress) next.running[key] = progress
    else delete next.running[key]
    if (failed !== undefined) next.failed[key] = failed
    return next
  })
}

/** Install platforms are dynamic: refresh the default and stored variants. */
function installPlatforms(gameInfo: GameInfo, deps: RefreshDeps) {
  const platforms = new Set<InstallPlatform>()
  if (!wantsInstallInfo(gameInfo, deps.online)) return platforms
  platforms.add(installPlatformOf(gameInfo, deps.platform))
  const key = detailsKey(gameInfo.runner, gameInfo.app_name)
  for (const slot of Object.keys(deps.store.getEntry(key)?.slots ?? {})) {
    if (isInstallInfoSlot(slot)) {
      platforms.add(slot.slice(slot.indexOf('@') + 1) as InstallPlatform)
    }
  }
  return platforms
}

/** Refreshes one game; a second call while running joins the first. */
export function refreshGameDetails(
  gameInfo: GameInfo,
  deps: RefreshDeps
): Promise<RefreshProgress> {
  const warn = deps.warn ?? console.warn
  const { app_name: appName, runner } = gameInfo
  const key = detailsKey(runner, appName)
  const pending = running.get(key)
  if (pending) return pending

  const run = (async () => {
    const current = deps.gameDetailsApi.beginRefresh(runner, appName)
    const settingsCurrent = deps.gameDetailsApi.settingsCurrent(appName)
    const platforms = installPlatforms(gameInfo, deps)
    const storeInfo = !gameInfo.browserUrl && runner !== 'sideload'
    const anticheat =
      !!gameInfo.title &&
      gameInfo.namespace !== undefined &&
      runner !== 'sideload'
    const progress: RefreshProgress = {
      done: 0,
      total: 6 + platforms.size + (storeInfo ? 2 : 0) + (anticheat ? 1 : 0),
      failed: 0
    }
    report(key, { ...progress })

    const invalidation = deps.gameDetailsApi.scheduleOperation(
      runner,
      appName,
      () =>
        deps.invalidateGameDetailsCaches({
          appName,
          runner,
          scope: 'all',
          artUrls: deps.online
            ? [
                ...gamePageArtUrls(gameInfo),
                ...getLibraryCardImageUrls([gameInfo])
              ]
            : undefined
        }),
      0,
      deps.online
    )
    deps.gameDetailsApi.holdFetches(runner, appName, invalidation)
    let backendDropped = false
    try {
      const result = await invalidation
      backendDropped = result.failed.length === 0
      if (!backendDropped || result.art.failed > 0) {
        warn(
          `[nk] game details refresh of ${appName}: backend caches not cleared: ${result.failed.join(', ')}; art failed: ${result.art.failed}`
        )
        progress.failed++
      } else if (current()) {
        deps.store.patchEntry(key, (entry) => ({
          ...entry,
          listSig: { ...entry.listSig, art: listSigOf(gameInfo).art }
        }))
      }
    } catch (error) {
      warn(`[nk] game details refresh of ${appName}: backend kept`, error)
      progress.failed++
    }
    progress.done++
    report(key, { ...progress })

    if (!backendDropped || !current()) {
      // fetching now would read the old backend data and look successful
      progress.failed += progress.total - 1
      progress.done = progress.total
      return progress
    }

    deps.store.dropSlots(
      [key],
      (slot) => isExtraInfoSlot(slot) && slot !== extraInfoSlot(deps.language)
    )
    const force = { force: true, recordListSig: false }
    const failedGroups = new Set<'meta' | 'install'>()
    const settle = async (
      work: Promise<unknown>,
      group?: 'meta' | 'install'
    ) => {
      try {
        await work
      } catch (error) {
        progress.failed++
        if (group) failedGroups.add(group)
        warn(`[nk] game details refresh of ${appName}:`, error)
      }
      progress.done++
      report(key, { ...progress })
    }
    if (!settingsCurrent()) failedGroups.add('install')
    const settings = settingsCurrent()
      ? settle(
          deps.gameDetailsApi.requestGameSettings(appName, force),
          'install'
        )
      : settle(Promise.resolve())
    const knownFixes = settle(
      deps.gameDetailsApi.getKnownFixes(appName, runner, force)
    )
    const status = settle(deps.refreshStatus(gameInfo, current))
    const extraInfo = storeInfo
      ? settle(deps.gameDetailsApi.getExtraInfo(appName, runner, force), 'meta')
      : Promise.resolve()
    const wikiInfo = storeInfo
      ? settle(
          deps.gameDetailsApi.getWikiGameInfo(
            gameInfo.title,
            appName,
            runner,
            force
          ),
          'meta'
        )
      : Promise.resolve()
    const anticheatInfo = anticheat
      ? settle(
          deps.gameDetailsApi.getAnticheatInfo(
            gameInfo.namespace!,
            runner,
            appName,
            force
          ),
          'meta'
        )
      : Promise.resolve()
    const achievements =
      runner !== 'gog'
        ? settle(
            deps.gameDetailsApi.getAchievements(
              appName,
              runner,
              undefined,
              force
            )
          )
        : Promise.resolve()
    const launchOptions =
      runner !== 'legendary'
        ? settle(
            deps.gameDetailsApi.getLaunchOptions(appName, runner, force),
            'install'
          )
        : Promise.resolve()
    const cli = (async () => {
      if (runner === 'gog') {
        await settle(
          deps.gameDetailsApi.getAchievements(appName, runner, undefined, force)
        )
      }
      for (const installPlatform of platforms) {
        if (!current()) return
        await settle(
          deps.gameDetailsApi.getInstallInfo(
            appName,
            runner,
            installPlatform,
            undefined,
            undefined,
            force
          ),
          'install'
        )
      }
      if (runner === 'legendary' && current()) {
        await settle(
          deps.gameDetailsApi.getLaunchOptions(appName, runner, force),
          'install'
        )
      }
    })()
    await Promise.all([
      settings,
      knownFixes,
      status,
      extraInfo,
      wikiInfo,
      anticheatInfo,
      achievements,
      launchOptions,
      cli
    ])
    if (!current()) return progress
    deps.store.patchEntry(key, (entry) => {
      const listSig = { ...entry.listSig }
      const current = listSigOf(gameInfo)
      if (!failedGroups.has('meta') && storeInfo) listSig.meta = current.meta
      if (!failedGroups.has('install')) listSig.install = current.install
      return { ...entry, listSig }
    })
    return progress
  })()
  running.set(key, run)
  void run.then(
    (progress) => {
      running.delete(key)
      report(key, null, progress.failed)
    },
    () => {
      running.delete(key)
      report(key, null, 1)
    }
  )
  return run
}
