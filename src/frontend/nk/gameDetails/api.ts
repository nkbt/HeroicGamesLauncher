// nk: #5 - `gameDetailsApi`: drop-in replacements for the `window.api` calls
// the game page makes, backed by the permanent game details store.
// - a filled slot resolves immediately with the stored object and makes no
//   IPC call (same identity every time, so upstream's unconditional setters
//   bail out); nothing expires;
// - a missing slot is fetched once; concurrent requests share one IPC call;
// - `{ force: true }` (Refresh, local events) always fetches, with its own
//   dedupe key per refresh epoch; equal data keeps the stored object;
// - errors and failure-shaped results never replace a filled slot and are
//   not stored; a call rejects only when nothing is cached, or when it was
//   forced (so Refresh can report it; the cached data stays);
// - a result of a fetch that started before the game's latest Refresh is
//   not stored (the Refresh's own fetch decides);
// - when a slot is stored, the signature of the library list data it was
//   fetched with is recorded for its group (meta / install).
import type {
  AntiCheatInfo,
  ExtraInfo,
  GameAchievement,
  GameInfo,
  GameSettings,
  InstallInfo,
  InstallPlatform,
  KnownFixesInfo,
  LaunchOption,
  Runner,
  WikiInfo
} from 'common/types'
import type { GameDetailsStore } from './store'
import type {
  DetailsScheduler,
  DetailsPriority,
  DetailsLane
} from './scheduler'
import {
  isEmptyWikiInfo,
  isFailureShapedExtraInfo,
  listSigOf,
  sameData
} from './logic'
import {
  detailsKey,
  type DetailsKey,
  extraInfoSlot,
  isExtraInfoSlot,
  installInfoSlot,
  listGroupOf,
  type ListSig,
  settingsKey,
  type SlotId
} from './types'

/** The subset of `window.api` used here (looked up at call time). */
export interface DetailsIpc {
  getExtraInfo: (appName: string, runner: Runner) => Promise<ExtraInfo | null>
  getWikiGameInfo: (
    title: string,
    appName: string,
    runner: Runner
  ) => Promise<WikiInfo | null>
  getAchievements: (
    appName: string,
    runner: Runner,
    lang?: string
  ) => Promise<GameAchievement[]>
  requestGameSettings: (appName: string) => Promise<GameSettings>
  getAnticheatInfo: (
    namespace: string
  ) => Promise<AntiCheatInfo | null | undefined>
  getKnownFixes: (
    appName: string,
    runner: Runner
  ) => Promise<KnownFixesInfo | null | undefined>
  getLaunchOptions: (appName: string, runner: Runner) => Promise<LaunchOption[]>
  getAchievementsForAccount: (
    appName: string,
    runner: Runner,
    accountId: string,
    lang?: string
  ) => Promise<GameAchievement[]>
  clearAchievementCache: (appName: string) => void
}

export interface ApiDeps {
  ipc: () => DetailsIpc
  /** frontend/helpers getInstallInfo (maps the platform per runner) */
  getInstallInfo: (
    appName: string,
    runner: Runner,
    installPlatform: InstallPlatform,
    build?: string,
    branch?: string
  ) => Promise<InstallInfo | null>
  scheduler?: DetailsScheduler
  getInstallInfoBackground?: ApiDeps['getInstallInfo']
  platform: string
  getLanguage: () => string
  getAccountId: (runner: Runner) => string | undefined
  isOnline: () => boolean
  /** the game's current library list entry, if the library is loaded */
  getLibraryGame: (runner: Runner, appName: string) => GameInfo | undefined
}

export interface FetchOptions {
  force?: boolean
  priority?: DetailsPriority
  installInfoBackground?: boolean
  /**
   * Record the list signature of the slot's group (default true). A local
   * event re-fills before the library list reflects the change, so it
   * leaves the group unrecorded.
   */
  recordListSig?: boolean
}

/** All-empty wiki results in a row before "no wiki data" is cached. */
export const WIKI_EMPTY_LIMIT = 3

interface ReadSpec<T> {
  /** IPC kind (stats) */
  kind: string
  key: DetailsKey
  slot: SlotId
  /** the game, for its list signature (none for settings) */
  runner?: Runner
  appName: string
  fetch: (options: FetchOptions) => Promise<T>
  options: FetchOptions
  accountId?: string
  /** a result that is not stored and never replaces a filled slot */
  isFailure?: (value: T, previous: T | null | undefined) => boolean
  /** forced fetches reject on failure-shaped results (default true) */
  failureRejects?: boolean
}

/** A forced fetch got an error-shaped result; the cached data was kept. */
export class FailureShapedResult extends Error {}

export type GameDetailsApi = ReturnType<typeof createGameDetailsApi>

export function createGameDetailsApi(store: GameDetailsStore, deps: ApiDeps) {
  const inflight = new Map<string, Promise<unknown>>()
  const requestOptions = new Map<
    string,
    FetchOptions & { backgroundRequested: boolean }
  >()
  let operation = 0
  const achievementEpochs = new Map<DetailsKey, number>()
  function joinRequest(id: string, options: FetchOptions) {
    const effective = requestOptions.get(id)
    if (effective) {
      if ((options.priority ?? 0) === 2) effective.backgroundRequested = true
      effective.priority = Math.min(
        effective.priority ?? 0,
        options.priority ?? 0
      ) as DetailsPriority
    }
    deps.scheduler?.promote(
      id,
      options.priority ?? 0,
      options.installInfoBackground ? 'installInfoBackground' : undefined
    )
  }
  const wikiInflight = new Map<string, Promise<WikiInfo | null>>()
  const listGroupEpochs = new Map<
    DetailsKey,
    { meta: number; install: number }
  >()
  const epochs = new Map<DetailsKey, number>()
  const holds = new Map<DetailsKey, Promise<unknown>>()
  const counts: Record<string, number> = {}

  let settingsGeneration = 0
  const epochOf = (key: DetailsKey, slot?: SlotId) => {
    const group = slot ? listGroupOf(slot) : null
    return (
      (epochs.get(key) ?? 0) +
      (slot === 'achievements' ? (achievementEpochs.get(key) ?? 0) : 0) +
      (key.startsWith('settings:') ? settingsGeneration : 0) +
      (group === 'meta' || group === 'install'
        ? (listGroupEpochs.get(key)?.[group] ?? 0)
        : 0)
    )
  }

  /**
   * A Refresh of this game starts: results of fetches that started before
   * it (game slots and the game's settings) are no longer stored.
   */
  function beginRefresh(
    runner: Runner,
    appName: string,
    scope?: 'install' | 'achievements'
  ) {
    const game = detailsKey(runner, appName)
    const settings = settingsKey(appName)
    deps.scheduler?.cancel(game, false, scope)
    deps.scheduler?.cancel(settings)
    if (scope === 'achievements') {
      achievementEpochs.set(game, (achievementEpochs.get(game) ?? 0) + 1)
    } else if (scope === 'install') {
      const groups = listGroupEpochs.get(game) ?? { meta: 0, install: 0 }
      listGroupEpochs.set(game, { ...groups, install: groups.install + 1 })
    } else epochs.set(game, epochOf(game) + 1)
    epochs.set(settings, epochOf(settings) + 1)
    const generation = store.generation()
    const version = store.version(game)
    const slot =
      scope === 'achievements'
        ? 'achievements'
        : scope === 'install'
          ? installInfoSlot('Windows')
          : undefined
    const epoch = epochOf(game, slot)
    const groups = listGroupEpochs.get(game)
    return () =>
      store.generation() === generation &&
      store.version(game) === version &&
      epochOf(game, slot) === epoch &&
      (scope === 'achievements' ||
        ((scope === 'install' ||
          (listGroupEpochs.get(game)?.meta ?? 0) === (groups?.meta ?? 0)) &&
          (listGroupEpochs.get(game)?.install ?? 0) === (groups?.install ?? 0)))
  }

  function settingsCurrent(appName: string) {
    const settings = settingsKey(appName)
    const generation = store.generation()
    const version = store.version(settings)
    const epoch = epochOf(settings)
    return () =>
      store.generation() === generation &&
      store.version(settings) === version &&
      epochOf(settings) === epoch
  }

  /**
   * Fetches of this game (and of its settings) wait for `until` (the
   * backend dropping its caches), so they never read the old backend data.
   */
  function holdFetches(
    runner: Runner,
    appName: string,
    until: Promise<unknown>,
    holdSettings = true
  ) {
    const settled = until.then(
      () => undefined,
      () => undefined
    )
    const game = detailsKey(runner, appName)
    const settings = settingsKey(appName)
    holds.set(game, settled)
    if (holdSettings) holds.set(settings, settled)
    void settled.then(() => {
      if (holds.get(game) === settled) holds.delete(game)
      if (holds.get(settings) === settled) holds.delete(settings)
    })
  }

  /** The list signature of the slot's group, taken when its fetch starts. */
  function listSigAtStart<T>(spec: ReadSpec<T>): ListSig | null {
    const group = listGroupOf(spec.slot)
    if (!group || !spec.runner || spec.options.recordListSig === false) {
      return null
    }
    const game = deps.getLibraryGame(spec.runner, spec.appName)
    if (!game) return null
    return { [group]: listSigOf(game)[group] }
  }

  function recordListSig(key: DetailsKey, sig: ListSig, slot: SlotId) {
    store.patchEntry(key, (entry) => {
      const listSig = { ...entry.listSig }
      let changed = false
      for (const group of Object.keys(sig) as Array<keyof ListSig>) {
        // a group keeps the oldest list data any of its slots was fetched
        // with, until all of them are fetched again (Refresh)
        const otherSlots = (Object.keys(entry.slots) as SlotId[]).some(
          (id) => id !== slot && listGroupOf(id) === group
        )
        if (!otherSlots && listSig[group] !== sig[group]) {
          listSig[group] = sig[group]
          changed = true
        }
      }
      return changed ? { ...entry, listSig } : entry
    })
  }

  function previous<T>(spec: ReadSpec<T>) {
    const slot = store.getSlot<T>(spec.key, spec.slot)
    return spec.accountId && slot?.accountId !== spec.accountId
      ? undefined
      : slot
  }
  function accountCurrent<T>(spec: ReadSpec<T>) {
    return (
      !spec.accountId ||
      (spec.runner !== undefined &&
        deps.getAccountId(spec.runner) === spec.accountId)
    )
  }
  function fetchInto<T>(spec: ReadSpec<T>): Promise<T | null> {
    const epoch = epochOf(spec.key, spec.slot)
    const generation = store.generation()
    const version = store.version(spec.key)
    const force = !!spec.options.force
    const id = `${spec.key}|${spec.slot}|${generation}|${version}|${epoch}|${force}${spec.accountId ? `|${spec.accountId}` : ''}`
    const running = inflight.get(id)
    if (running && !deps.scheduler?.isCancelled(id)) {
      joinRequest(id, spec.options)
      return running as Promise<T | null>
    }

    const effective = {
      ...spec.options,
      priority: spec.options.priority ?? 0,
      backgroundRequested: spec.options.priority === 2
    }
    let lane: DetailsLane = 'local'
    let network = false
    if (spec.kind === 'getWikiGameInfo') {
      lane = 'wiki'
      network = true
    } else if (spec.kind === 'getInstallInfo') {
      lane =
        effective.installInfoBackground && effective.priority === 2
          ? 'installInfoBackground'
          : 'cli'
      network = true
    } else if (
      spec.kind === 'getLaunchOptions' &&
      spec.runner === 'legendary'
    ) {
      lane = 'cli'
      network = true
    } else if (spec.kind === 'getAchievements' && spec.runner === 'gog') {
      lane = 'cli'
      network = true
    } else if (
      spec.kind === 'getExtraInfo' &&
      (spec.runner === 'gog' || spec.runner === 'legendary')
    ) {
      lane = 'storeApi'
      network = true
    }
    requestOptions.set(id, effective)
    const intent = deps.scheduler?.prepare({
      id,
      key: spec.key,
      slot: spec.slot,
      lane,
      network,
      priority: effective.priority,
      backgroundRequested: effective.backgroundRequested,
      backgroundLane: effective.priority === 2 ? lane : undefined
    })
    const run = (async (): Promise<T | null> => {
      await holds.get(spec.key)
      effective.priority = intent?.priority ?? effective.priority
      effective.backgroundRequested =
        intent?.backgroundRequested ?? effective.backgroundRequested
      if (!accountCurrent(spec)) return [] as T
      if (
        intent?.cancelled ||
        store.generation() !== generation ||
        store.version(spec.key) !== version ||
        epochOf(spec.key, spec.slot) !== epoch
      ) {
        if (!effective.backgroundRequested && spec.options.priority !== 1)
          return previous(spec)?.data ?? null
        const error = new Error('Detail request cancelled before dispatch')
        error.name = 'DetailsRequestCancelled'
        throw error
      }
      const sig = listSigAtStart(spec)
      const gameInfo = spec.runner
        ? deps.getLibraryGame(spec.runner, spec.appName)
        : undefined
      let value: T
      try {
        const priority = effective.priority
        if (priority < 2 && lane === 'installInfoBackground') lane = 'cli'
        const fetch = async (lane: DetailsLane = 'local') => {
          if (!accountCurrent(spec)) return [] as T
          if (
            store.generation() !== generation ||
            store.version(spec.key) !== version ||
            epochOf(spec.key, spec.slot) !== epoch ||
            (isExtraInfoSlot(spec.slot) &&
              spec.slot !== extraInfoSlot(deps.getLanguage()))
          ) {
            if (!effective.backgroundRequested && spec.options.priority !== 1)
              return previous(spec)?.data as T
            const error = new Error('Detail request cancelled before dispatch')
            error.name = 'DetailsRequestCancelled'
            throw error
          }
          counts[spec.kind] = (counts[spec.kind] ?? 0) + 1
          return spec.fetch({
            ...effective,
            installInfoBackground: lane === 'installInfoBackground'
          })
        }
        value = deps.scheduler
          ? await deps.scheduler.enqueue(
              {
                id,
                key: spec.key,
                slot: spec.slot,
                lane,
                network,
                priority,
                backgroundRequested: effective.backgroundRequested
              },
              fetch
            )
          : await fetch(lane)
      } catch (error) {
        if (!accountCurrent(spec)) return [] as T
        if (error instanceof Error && error.name === 'DetailsRequestCancelled')
          throw error
        const cached = previous(spec)
        if (cached && !force) return cached.data
        throw error
      }
      const cached = previous(spec)
      if (!accountCurrent(spec)) return [] as T
      // a Refresh started meanwhile: its own fetch decides what is stored
      if (
        epochOf(spec.key, spec.slot) !== epoch ||
        store.generation() !== generation ||
        store.version(spec.key) !== version ||
        (isExtraInfoSlot(spec.slot) &&
          spec.slot !== extraInfoSlot(deps.getLanguage()))
      ) {
        return cached ? cached.data : value
      }
      if (spec.isFailure?.(value, cached?.data)) {
        if (force && (spec.failureRejects !== false || cached?.data != null)) {
          throw new FailureShapedResult(spec.kind)
        }
        return cached && cached.data != null ? cached.data : value
      }
      return store.batchUpdates(
        () => {
          const stored =
            cached && sameData(cached.data, value)
              ? cached.data
              : store.setSlot<T>(spec.key, spec.slot, value, spec.accountId)
                  .data
          if (gameInfo)
            store.patchEntry(spec.key, (entry) =>
              entry.gameInfo === gameInfo ? entry : { ...entry, gameInfo }
            )
          if (sig) recordListSig(spec.key, sig, spec.slot)
          return stored
        },
        (effective.priority ?? 0) > 0
      )
    })()
    inflight.set(id, run)
    const forget = () => {
      if (inflight.get(id) === run) {
        inflight.delete(id)
        requestOptions.delete(id)
        deps.scheduler?.release(id)
      }
    }
    run.then(forget, forget)
    return run
  }

  async function read<T>(spec: ReadSpec<T>): Promise<T | null> {
    const cached = previous(spec)
    if (cached && !spec.options.force) return cached.data
    return fetchInto(spec)
  }

  /** Wiki info, plus the "no wiki data" bookkeeping (once per fetch). */
  function getWikiGameInfo(
    title: string,
    appName: string,
    runner: Runner,
    options: FetchOptions = {}
  ): Promise<WikiInfo | null> {
    const key = detailsKey(runner, appName)
    const cached = store.getSlot<WikiInfo>(key, 'wikiInfo')
    if (cached && !options.force) return Promise.resolve(cached.data)
    const epoch = epochOf(key, 'wikiInfo')
    const generation = store.generation()
    const version = store.version(key)
    const id = `${key}|${generation}|${version}|${epoch}|${!!options.force}`
    const running = wikiInflight.get(id)
    if (
      running &&
      !deps.scheduler?.isCancelled(
        `${key}|wikiInfo|${generation}|${version}|${epoch}|${!!options.force}`
      )
    ) {
      joinRequest(
        `${key}|wikiInfo|${generation}|${version}|${epoch}|${!!options.force}`,
        options
      )
      return running
    }

    const run = (async () => {
      if (options.force) {
        // a forced fetch starts over: a cached "no wiki data" marker goes
        store.patchEntry(key, (entry) =>
          entry.wikiEmpty ? { ...entry, wikiEmpty: 0 } : entry
        )
        if (store.getSlot(key, 'wikiInfo')?.data === null) {
          store.dropSlots([key], (slot) => slot === 'wikiInfo')
        }
      }
      const info = await fetchInto<WikiInfo | null>({
        kind: 'getWikiGameInfo',
        key,
        slot: 'wikiInfo',
        runner,
        appName,
        options,
        fetch: async () => deps.ipc().getWikiGameInfo(title, appName, runner),
        // every source empty: most likely a network failure (or a game
        // without third-party data, so a Refresh does not report it)
        isFailure: (v) => isEmptyWikiInfo(v),
        failureRejects: false
      })
      if (
        epochOf(key, 'wikiInfo') !== epoch ||
        store.generation() !== generation ||
        store.version(key) !== version
      )
        return info
      store.batchUpdates(
        () => {
          if (!isEmptyWikiInfo(info)) {
            store.patchEntry(key, (entry) =>
              entry.wikiEmpty ? { ...entry, wikiEmpty: 0 } : entry
            )
          } else if (!store.getSlot(key, 'wikiInfo') && deps.isOnline()) {
            // a game that really has no third-party data stops being retried
            const wikiEmpty = (store.getEntry(key)?.wikiEmpty ?? 0) + 1
            store.patchEntry(key, (entry) => ({ ...entry, wikiEmpty }))
            if (wikiEmpty >= WIKI_EMPTY_LIMIT)
              store.setSlot(key, 'wikiInfo', null)
          }
        },
        (options.priority ?? 0) > 0
      )
      return info
    })()
    wikiInflight.set(id, run)
    const forget = () => {
      if (wikiInflight.get(id) === run) wikiInflight.delete(id)
    }
    run.then(forget, forget)
    return run
  }

  return {
    getAccountId: deps.getAccountId,
    getExtraInfo: async (
      appName: string,
      runner: Runner,
      options: FetchOptions = {}
    ) =>
      read<ExtraInfo | null>({
        kind: 'getExtraInfo',
        key: detailsKey(runner, appName),
        slot: extraInfoSlot(deps.getLanguage()),
        runner,
        appName,
        options,
        fetch: async () => deps.ipc().getExtraInfo(appName, runner),
        isFailure: (v) => isFailureShapedExtraInfo(v, runner)
      }),

    getWikiGameInfo,

    getAchievements: async (
      appName: string,
      runner: Runner,
      lang?: string,
      options: FetchOptions = {}
    ) => {
      const accountId = runner === 'gog' ? deps.getAccountId(runner) : undefined
      if (runner === 'gog' && !accountId) return []
      const achievements = await read<GameAchievement[]>({
        kind: 'getAchievements',
        key: detailsKey(runner, appName),
        slot: 'achievements',
        runner,
        appName,
        options,
        accountId,
        fetch: async () =>
          accountId
            ? deps
                .ipc()
                .getAchievementsForAccount(appName, runner, accountId, lang)
            : deps.ipc().getAchievements(appName, runner, lang),
        isFailure: (value, cached) =>
          (value ?? []).length === 0 &&
          (!!cached?.length || (runner === 'gog' && !deps.isOnline()))
      })
      return runner === 'gog' && deps.getAccountId(runner) !== accountId
        ? []
        : (achievements ?? [])
    },

    getInstallInfo: async (
      appName: string,
      runner: Runner,
      installPlatform: InstallPlatform,
      build?: string,
      branch?: string,
      options: FetchOptions = {}
    ) => {
      // only the default build/branch (what the game page shows) is cached
      if (build !== undefined || branch !== undefined) {
        return deps.getInstallInfo(
          appName,
          runner,
          installPlatform,
          build,
          branch
        )
      }
      return read<InstallInfo | null>({
        kind: 'getInstallInfo',
        key: detailsKey(runner, appName),
        slot: installInfoSlot(installPlatform),
        runner,
        appName,
        options,
        fetch: async (options) =>
          options.installInfoBackground && deps.getInstallInfoBackground
            ? deps.getInstallInfoBackground(appName, runner, installPlatform)
            : deps.getInstallInfo(appName, runner, installPlatform),
        // null means "Cannot get game info"
        isFailure: (v) => !v
      })
    },

    requestGameSettings: async (appName: string, options: FetchOptions = {}) =>
      read<GameSettings>({
        kind: 'requestGameSettings',
        key: settingsKey(appName),
        slot: 'settings',
        appName,
        options,
        fetch: async () => deps.ipc().requestGameSettings(appName),
        isFailure: (v) => !v || Object.keys(v).length === 0
      }) as Promise<GameSettings>,

    getAnticheatInfo: async (
      namespace: string,
      runner: Runner,
      appName: string,
      options: FetchOptions = {}
    ) =>
      (await read<AntiCheatInfo | null | undefined>({
        kind: 'getAnticheatInfo',
        key: detailsKey(runner, appName),
        slot: 'anticheat',
        runner,
        appName,
        options,
        fetch: async () => deps.ipc().getAnticheatInfo(namespace),
        // Undefined is a successful lookup with no entry. Windows explicitly
        // has no anti-cheat data; null on supported platforms is a file failure.
        isFailure: (value) => value === null && deps.platform !== 'win32'
      })) ?? null,

    getKnownFixes: async (
      appName: string,
      runner: Runner,
      options: FetchOptions = {}
    ) =>
      read<KnownFixesInfo | null | undefined>({
        kind: 'getKnownFixes',
        key: detailsKey(runner, appName),
        slot: 'knownFixes',
        runner,
        appName,
        options,
        fetch: async () => deps.ipc().getKnownFixes(appName, runner),
        // Undefined is a successful lookup with no entry. Null means the file
        // is missing/malformed, except for the explicitly unsupported runner.
        isFailure: (value) => value === null && runner !== 'sideload'
      }),

    getLaunchOptions: async (
      appName: string,
      runner: Runner,
      options: FetchOptions = {}
    ) =>
      (await read<LaunchOption[]>({
        kind: 'getLaunchOptions',
        key: detailsKey(runner, appName),
        slot: 'launchOptions',
        runner,
        appName,
        options,
        fetch: async () => deps.ipc().getLaunchOptions(appName, runner),
        isFailure: (value) => !Array.isArray(value)
      })) ?? [],

    scheduleOperation<T>(
      runner: Runner,
      appName: string,
      work: () => Promise<T>,
      priority: DetailsPriority = 0,
      network = false
    ) {
      const key = detailsKey(runner, appName)
      return deps.scheduler
        ? deps.scheduler.enqueue(
            {
              id: `${key}|barrier|${++operation}`,
              key,
              lane: 'local',
              network,
              priority
            },
            work
          )
        : work()
    },
    beginListUpdate(
      runner: Runner,
      appName: string,
      meta: boolean,
      install: boolean
    ) {
      const key = detailsKey(runner, appName)
      const previous = listGroupEpochs.get(key) ?? { meta: 0, install: 0 }
      const groups = {
        meta: previous.meta + (meta ? 1 : 0),
        install: previous.install + (install ? 1 : 0)
      }
      listGroupEpochs.set(key, groups)
      if (install) {
        const settings = settingsKey(appName)
        epochs.set(settings, epochOf(settings) + 1)
      }
      const generation = store.generation()
      const version = store.version(key)
      const epoch = epochOf(key)
      return () =>
        store.generation() === generation &&
        store.version(key) === version &&
        epochOf(key) === epoch &&
        (!meta || listGroupEpochs.get(key)?.meta === groups.meta) &&
        (!install || listGroupEpochs.get(key)?.install === groups.install)
    },
    beginRefresh,
    settingsCurrent,
    invalidateAllSettings: () => {
      settingsGeneration++
    },
    invalidateSettings: (appName: string) => {
      const key = settingsKey(appName)
      epochs.set(key, epochOf(key) + 1)
    },
    holdFetches,

    /** IPC calls forwarded per kind (acceptance checks) */
    stats: () => ({ ...counts })
  }
}
