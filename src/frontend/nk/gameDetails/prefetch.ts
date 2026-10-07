// nk: #5 - permanent missing-only attempts, shared across route remounts.
import type { GameInfo } from 'common/types'
import type { GameDetailsApi, FetchOptions } from './api'
import type { GameDetailsStore } from './store'
import {
  detailsKey,
  extraInfoSlot,
  installInfoSlot,
  settingsKey
} from './types'
import { installPlatformOf } from './logic'

export function createDetailsPrefetch(
  gameDetailsApi: GameDetailsApi,
  store: GameDetailsStore,
  platform: string,
  getLanguage: () => string,
  report = console.info
) {
  const attempted = new Map<string, object>()
  let completed = 0
  let successful = 0
  let failed = 0
  function missing(gameInfo: GameInfo, slot: string, priority: 1 | 2) {
    const key = detailsKey(gameInfo.runner, gameInfo.app_name)
    const id = `${key}|${slot}|${store.generation()}|${store.version(key)}`
    if (priority === 2 && attempted.has(id)) return false
    attempted.set(id, {})
    return true
  }
  async function prefetch(
    gameInfo: GameInfo,
    priority: 1 | 2 = 2,
    languageOnly = false
  ) {
    const { app_name: appName, runner } = gameInfo
    if (gameInfo.install?.is_dlc) return
    const key = detailsKey(runner, appName)
    const options: FetchOptions = { priority }
    const work: Promise<unknown>[] = []
    function track(slot: string, request: Promise<unknown>) {
      const id = `${key}|${slot}|${store.generation()}|${store.version(key)}`
      const owner = attempted.get(id)
      return request.catch((error: unknown) => {
        if (
          error instanceof Error &&
          error.name === 'DetailsRequestCancelled' &&
          attempted.get(id) === owner
        )
          attempted.delete(id)
        throw error
      })
    }
    if (
      !gameInfo.browserUrl &&
      runner !== 'sideload' &&
      !store.getSlot(key, extraInfoSlot(getLanguage())) &&
      missing(gameInfo, extraInfoSlot(getLanguage()), priority)
    )
      work.push(
        track(
          extraInfoSlot(getLanguage()),
          gameDetailsApi.getExtraInfo(appName, runner, options)
        )
      )
    if (languageOnly) {
      await Promise.allSettled(work)
      return
    }
    if (
      !gameInfo.browserUrl &&
      runner !== 'sideload' &&
      !store.getSlot(key, 'wikiInfo') &&
      missing(gameInfo, 'wikiInfo', priority)
    )
      work.push(
        track(
          'wikiInfo',
          gameDetailsApi.getWikiGameInfo(
            gameInfo.title,
            appName,
            runner,
            options
          )
        )
      )
    if (
      !store.getSlot(settingsKey(appName), 'settings') &&
      missing(gameInfo, 'settings', priority)
    )
      work.push(
        track('settings', gameDetailsApi.requestGameSettings(appName, options))
      )
    if (
      gameInfo.namespace !== undefined &&
      runner !== 'sideload' &&
      !store.getSlot(key, 'anticheat') &&
      missing(gameInfo, 'anticheat', priority)
    )
      work.push(
        track(
          'anticheat',
          gameDetailsApi.getAnticheatInfo(
            gameInfo.namespace,
            runner,
            appName,
            options
          )
        )
      )
    if (
      !store.getSlot(key, 'knownFixes') &&
      missing(gameInfo, 'knownFixes', priority)
    )
      work.push(
        track(
          'knownFixes',
          gameDetailsApi.getKnownFixes(appName, runner, options)
        )
      )
    if (
      !store.getSlot(key, 'achievements') &&
      missing(gameInfo, 'achievements', priority)
    )
      work.push(
        track(
          'achievements',
          gameDetailsApi.getAchievements(appName, runner, undefined, options)
        )
      )
    if (
      !store.getSlot(key, 'launchOptions') &&
      missing(gameInfo, 'launchOptions', priority)
    )
      work.push(
        track(
          'launchOptions',
          gameDetailsApi.getLaunchOptions(appName, runner, options)
        )
      )
    const installPlatform = installPlatformOf(gameInfo, platform)
    const slow =
      runner !== 'sideload' &&
      !gameInfo.thirdPartyManagedApp &&
      !store.getSlot(key, installInfoSlot(installPlatform)) &&
      missing(gameInfo, installInfoSlot(installPlatform), priority)
    let installWork: Promise<unknown> | undefined
    if (slow) {
      installWork = track(
        installInfoSlot(installPlatform),
        gameDetailsApi.getInstallInfo(
          appName,
          runner,
          installPlatform,
          undefined,
          undefined,
          {
            priority,
            installInfoBackground: priority === 2 && !gameInfo.is_installed
          }
        )
      )
      work.push(installWork)
    }
    const results = await Promise.allSettled(work)
    if (
      results.some(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof Error &&
          result.reason.name === 'DetailsRequestCancelled'
      )
    ) {
      return
    }
    if (slow && priority === 2 && !gameInfo.is_installed) {
      completed++
      if (store.getSlot(key, installInfoSlot(installPlatform))) successful++
      else failed++
      if (completed % 50 === 0)
        report(
          `[nk] game details install attempts: ${completed} completed, ${successful} successful, ${failed} failed`
        )
    }
  }
  return { prefetch }
}
