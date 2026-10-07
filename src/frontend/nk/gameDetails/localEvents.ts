// nk: #5 - real local changes of a game update its cached details, whether
// its game page is open or not (see statusInvalidation.ts for the events).
import type { GameInfo, InstallPlatform, Runner } from 'common/types'
import type {
  InvalidateGameDetailsRequest,
  InvalidateGameDetailsResult
} from 'common/types/nk/gameDetails'
import type { GameDetailsApi } from './api'
import type { GameDetailsStore } from './store'
import { listSigOf } from './logic'
import { forgetStatus } from './statusMemo'
import { detailsKey, isInstallInfoSlot, settingsKey } from './types'

export interface LocalEventDeps {
  gameDetailsApi: GameDetailsApi
  store: GameDetailsStore
  invalidateGameDetailsCaches: (
    request: InvalidateGameDetailsRequest
  ) => Promise<InvalidateGameDetailsResult>
  getLibraryGame?: (runner: Runner, appName: string) => GameInfo | undefined
  isOnline: () => boolean
  warn?: (...args: unknown[]) => void
}

export function createLocalEvents({
  gameDetailsApi,
  store,
  invalidateGameDetailsCaches,
  isOnline,
  getLibraryGame,
  warn = console.warn
}: LocalEventDeps) {
  async function settle(appName: string, work: Array<Promise<unknown>>) {
    const results = await Promise.allSettled(work)
    for (const result of results) {
      if (result.status === 'rejected') {
        warn(`[nk] game details: re-fill of ${appName} failed`, result.reason)
      }
    }
    return results.every((result) => result.status === 'fulfilled')
  }

  /**
   * An install, uninstall, update, repair or move finished. The backend
   * drops the game's install info first (fetches of this game wait for
   * it). Its remembered status is dropped and cached install info, launch
   * options and settings are fetched again, retaining good values on failure.
   * The install list group is left unrecorded: the library list catches
   * up with the change after the event.
   */
  async function installChanged(appName: string, runner: Runner) {
    const key = detailsKey(runner, appName)
    const settings = settingsKey(appName)
    const gameInfo = getLibraryGame?.(runner, appName)
    const installEventBaseline = gameInfo
      ? listSigOf(gameInfo).install
      : undefined
    const current = gameDetailsApi.beginRefresh(runner, appName, 'install')
    const settingsCurrent = gameDetailsApi.settingsCurrent(appName)
    store.patchEntry(key, (entry) => ({
      ...entry,
      pendingInstall: true,
      installEventBaseline:
        entry.observedListSig?.install ??
        entry.listSig?.install ??
        installEventBaseline
    }))
    const invalidation = gameDetailsApi.scheduleOperation(runner, appName, () =>
      invalidateGameDetailsCaches({
        appName,
        runner,
        scope: 'install'
      })
    )
    gameDetailsApi.holdFetches(runner, appName, invalidation)
    forgetStatus(appName)
    try {
      const result = await invalidation
      if (result.failed.length) {
        warn(
          `[nk] game details: install caches of ${appName} could not be cleared`,
          result.failed
        )
        return
      }
    } catch (error) {
      warn(
        `[nk] game details: install caches of ${appName} could not be cleared`,
        error
      )
      return
    }
    await store.hydrationReady
    if (!current()) return
    const platforms = Object.keys(store.getEntry(key)?.slots ?? {})
      .filter(isInstallInfoSlot)
      .map((slot) => slot.slice(slot.indexOf('@') + 1))
    const hadLaunchOptions = !!store.getSlot(key, 'launchOptions')
    const hadSettings = !!store.getSlot(settings, 'settings')

    store.patchEntry(key, (entry) => {
      if (entry.listSig?.install === undefined) return entry
      const listSig = { ...entry.listSig }
      delete listSig.install
      return { ...entry, listSig }
    })

    const options = { force: true, recordListSig: false }
    const refills: Array<Promise<unknown>> = []
    if (hadSettings && settingsCurrent())
      refills.push(gameDetailsApi.requestGameSettings(appName, options))
    if (hadLaunchOptions && (runner !== 'legendary' || isOnline())) {
      refills.push(gameDetailsApi.getLaunchOptions(appName, runner, options))
    }
    if (isOnline()) {
      for (const installPlatform of platforms) {
        refills.push(
          gameDetailsApi.getInstallInfo(
            appName,
            runner,
            installPlatform as InstallPlatform,
            undefined,
            undefined,
            options
          )
        )
      }
    }
    const succeeded = await settle(appName, refills)
    if (current() && succeeded && isOnline())
      store.patchEntry(key, (entry) => {
        const gameInfo = getLibraryGame?.(runner, appName)
        const install = gameInfo ? listSigOf(gameInfo).install : undefined
        const matched =
          install !== undefined &&
          entry.installEventBaseline !== undefined &&
          install !== entry.installEventBaseline
        const pendingListSig = { ...entry.pendingListSig }
        delete pendingListSig.install
        return {
          ...entry,
          pendingInstall: false,
          pendingListSig,
          installEventBaseline: matched
            ? undefined
            : entry.installEventBaseline,
          listSig: matched ? { ...entry.listSig, install } : entry.listSig
        }
      })
  }

  /**
   * A play session ended: achievements (GOG keeps a backend cache of them)
   * and settings (a launch can change the wine settings) are fetched again
   * when cached, retaining good values if a fetch fails.
   */
  async function played(appName: string, runner: Runner) {
    const key = detailsKey(runner, appName)
    const settings = settingsKey(appName)

    const current = gameDetailsApi.beginRefresh(runner, appName, 'achievements')
    const settingsCurrent = gameDetailsApi.settingsCurrent(appName)
    store.patchEntry(key, (entry) => ({ ...entry, pendingPlay: true }))
    if (runner === 'gog') {
      const invalidation = gameDetailsApi.scheduleOperation(
        runner,
        appName,
        () =>
          invalidateGameDetailsCaches({
            appName,
            runner,
            scope: 'achievements'
          })
      )
      gameDetailsApi.holdFetches(runner, appName, invalidation)
      try {
        const result = await invalidation
        if (result.failed.length) return
      } catch (error) {
        warn(
          `[nk] game details: achievements of ${appName} could not be cleared`,
          error
        )
        return
      }
    }
    await store.hydrationReady
    if (!current()) return
    const hadAchievements = !!store.getSlot(key, 'achievements')
    const hadSettings = !!store.getSlot(settings, 'settings')

    const refills: Array<Promise<unknown>> = []
    if (hadAchievements && isOnline()) {
      refills.push(
        gameDetailsApi.getAchievements(appName, runner, undefined, {
          force: true
        })
      )
    }
    if (hadSettings && settingsCurrent())
      refills.push(gameDetailsApi.requestGameSettings(appName, { force: true }))
    const succeeded = await settle(appName, refills)
    if (current() && succeeded && (!hadAchievements || isOnline()))
      store.patchEntry(key, (entry) => ({ ...entry, pendingPlay: false }))
  }

  async function reconnect() {
    if (!isOnline()) return
    for (const key of store.keys()) {
      if (key.startsWith('settings:')) continue
      const entry = store.getEntry(key)
      const separator = key.indexOf(':')
      const runner = key.slice(0, separator) as Runner
      const appName = key.slice(separator + 1)
      if (entry?.pendingInstall) await installChanged(appName, runner)
      if (entry?.pendingPlay) await played(appName, runner)
    }
  }

  return { installChanged, played, reconnect }
}
