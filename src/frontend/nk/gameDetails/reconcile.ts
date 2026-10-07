// nk: #5 - authoritative list changes refill only affected detail groups.
import type { GameInfo, InstallPlatform } from 'common/types'
import type {
  InvalidateGameDetailsRequest,
  InvalidateGameDetailsResult
} from 'common/types/nk/gameDetails'
import type { GameDetailsApi } from './api'
import type { GameDetailsStore } from './store'
import { installPlatformOf, listSigOf } from './logic'
import {
  detailsKey,
  extraInfoSlot,
  isExtraInfoSlot,
  isInstallInfoSlot,
  settingsKey
} from './types'

export function createDetailsReconciliation(
  store: GameDetailsStore,
  gameDetailsApi: GameDetailsApi,
  invalidateGameDetailsCaches: (
    request: InvalidateGameDetailsRequest
  ) => Promise<InvalidateGameDetailsResult>,
  platform: string,
  getLanguage: () => string
) {
  const running = new Map<string, Promise<void>>()
  async function refill(gameInfo: GameInfo, meta: boolean, install: boolean) {
    const { runner, app_name: appName } = gameInfo
    const key = detailsKey(runner, appName)
    const listSig = listSigOf(gameInfo)
    const id = `${key}|${listSig.meta}|${listSig.install}|${meta}|${install}`
    if (running.has(id)) return running.get(id)
    const work = (async () => {
      const current = gameDetailsApi.beginListUpdate(
        runner,
        appName,
        meta,
        install
      )
      const settingsCurrent = gameDetailsApi.settingsCurrent(appName)
      const language = getLanguage()
      const invalidation = gameDetailsApi.scheduleOperation(
        runner,
        appName,
        async () => {
          if (meta) {
            const result = await invalidateGameDetailsCaches({
              runner,
              appName,
              scope: 'meta'
            })
            if (result.failed.length)
              throw new Error('Metadata invalidation failed')
          }
          if (install) {
            const result = await invalidateGameDetailsCaches({
              runner,
              appName,
              scope: 'install'
            })
            if (result.failed.length)
              throw new Error('Install invalidation failed')
          }
        },
        2
      )
      gameDetailsApi.holdFetches(runner, appName, invalidation, install)
      try {
        await invalidation
      } catch {
        return
      }
      if (!current()) return
      const options = {
        force: true,
        recordListSig: false,
        priority: 2 as const
      }
      let metaSucceeded = true
      let installSucceeded = settingsCurrent()
      if (meta) {
        const work: Promise<unknown>[] = []
        if (!gameInfo.browserUrl && runner !== 'sideload') {
          work.push(gameDetailsApi.getExtraInfo(appName, runner, options))
          work.push(
            gameDetailsApi.getWikiGameInfo(
              gameInfo.title,
              appName,
              runner,
              options
            )
          )
        }
        if (gameInfo.namespace !== undefined && runner !== 'sideload')
          work.push(
            gameDetailsApi.getAnticheatInfo(
              gameInfo.namespace,
              runner,
              appName,
              options
            )
          )
        const results = await Promise.allSettled(work)
        metaSucceeded = results.every((result) => result.status === 'fulfilled')
        if (!gameInfo.browserUrl && runner !== 'sideload')
          metaSucceeded =
            metaSucceeded &&
            !!store.getSlot(key, extraInfoSlot(getLanguage())) &&
            !!store.getSlot(key, 'wikiInfo')
      }
      if (install && current()) {
        const work: Promise<unknown>[] = []
        if (settingsCurrent())
          work.push(gameDetailsApi.requestGameSettings(appName, options))
        work.push(gameDetailsApi.getLaunchOptions(appName, runner, options))
        const platforms = new Set<InstallPlatform>()
        if (runner !== 'sideload' && !gameInfo.thirdPartyManagedApp)
          platforms.add(installPlatformOf(gameInfo, platform))
        for (const slot of Object.keys(store.getEntry(key)?.slots ?? {}))
          if (isInstallInfoSlot(slot))
            platforms.add(slot.slice(slot.indexOf('@') + 1) as InstallPlatform)
        for (const installPlatform of platforms)
          work.push(
            gameDetailsApi.getInstallInfo(
              appName,
              runner,
              installPlatform,
              undefined,
              undefined,
              options
            )
          )
        const results = await Promise.allSettled(work)
        installSucceeded =
          installSucceeded &&
          settingsCurrent() &&
          results.every((result) => result.status === 'fulfilled') &&
          !!store.getSlot(settingsKey(appName), 'settings')
      }
      if (!current()) return
      if (language !== getLanguage()) metaSucceeded = false
      store.batchUpdates(() => {
        if (meta && metaSucceeded)
          store.dropSlots(
            [key],
            (slot) =>
              isExtraInfoSlot(slot) && slot !== extraInfoSlot(getLanguage())
          )
        store.patchEntry(key, (entry) => {
          const verified = { ...entry.listSig }
          const pendingListSig = { ...entry.pendingListSig }
          if (meta && metaSucceeded) {
            verified.meta = listSig.meta
            delete pendingListSig.meta
          }
          if (install && installSucceeded) {
            verified.install = listSig.install
            delete pendingListSig.install
          }
          return { ...entry, listSig: verified, pendingListSig }
        })
      }, true)
    })()
    running.set(id, work)
    void work.finally(() => {
      running.delete(id)
    })
    return work
  }
  function observe(gameInfo: GameInfo) {
    const key = detailsKey(gameInfo.runner, gameInfo.app_name)
    const entry = store.getEntry(key)
    const listSig = listSigOf(gameInfo)
    if (
      entry?.observedListSig?.meta === listSig.meta &&
      entry.observedListSig.install === listSig.install &&
      entry.observedListSig.art === listSig.art
    )
      return
    const previous = entry?.observedListSig ?? entry?.listSig
    let meta = previous?.meta !== undefined && previous.meta !== listSig.meta
    let install =
      previous?.install !== undefined && previous.install !== listSig.install
    if (!entry || Object.keys(entry.slots).length === 0) {
      meta = false
      install = false
    }
    const completedInstall =
      !entry?.pendingInstall &&
      entry?.installEventBaseline !== undefined &&
      entry.installEventBaseline !== listSig.install
    store.batchUpdates(
      () =>
        store.patchEntry(key, (entry) => {
          const pendingListSig = { ...entry.pendingListSig }
          if (meta) pendingListSig.meta = listSig.meta
          if (install && !completedInstall && !entry.pendingInstall)
            pendingListSig.install = listSig.install
          const verified = { ...entry.listSig }
          if (completedInstall) {
            verified.install = listSig.install
            delete pendingListSig.install
          }
          return {
            ...entry,
            gameInfo,
            observedListSig: listSig,
            pendingListSig,
            listSig: verified,
            installEventBaseline: completedInstall
              ? undefined
              : entry.installEventBaseline
          }
        }),
      true
    )
    const pending = store.getEntry(key)?.pendingListSig
    const pendingInstall =
      !!pending?.install && !store.getEntry(key)?.pendingInstall
    if (meta || (install && pendingInstall))
      void refill(gameInfo, meta, install && pendingInstall)
  }
  return { observe }
}
