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
  platform: string
  getLanguage: () => string
  isOnline: () => boolean
  /** the game's current library list entry, if the library is loaded */
  getLibraryGame: (runner: Runner, appName: string) => GameInfo | undefined
}

export interface FetchOptions {
  force?: boolean
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
  fetch: () => Promise<T>
  options: FetchOptions
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
  const wikiInflight = new Map<string, Promise<WikiInfo | null>>()
  const epochs = new Map<DetailsKey, number>()
  const holds = new Map<DetailsKey, Promise<unknown>>()
  const counts: Record<string, number> = {}

  let settingsGeneration = 0
  const epochOf = (key: DetailsKey) =>
    (epochs.get(key) ?? 0) +
    (key.startsWith('settings:') ? settingsGeneration : 0)

  /**
   * A Refresh of this game starts: results of fetches that started before
   * it (game slots and the game's settings) are no longer stored.
   */
  function beginRefresh(runner: Runner, appName: string) {
    const game = detailsKey(runner, appName)
    const settings = settingsKey(appName)
    epochs.set(game, epochOf(game) + 1)
    epochs.set(settings, epochOf(settings) + 1)
    const generation = store.generation()
    const version = store.version(game)
    const epoch = epochOf(game)
    return () =>
      store.generation() === generation &&
      store.version(game) === version &&
      epochOf(game) === epoch
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
    until: Promise<unknown>
  ) {
    const settled = until.then(
      () => undefined,
      () => undefined
    )
    const game = detailsKey(runner, appName)
    const settings = settingsKey(appName)
    holds.set(game, settled)
    holds.set(settings, settled)
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

  function fetchInto<T>(spec: ReadSpec<T>): Promise<T | null> {
    const epoch = epochOf(spec.key)
    const generation = store.generation()
    const version = store.version(spec.key)
    const force = !!spec.options.force
    const id = `${spec.key}|${spec.slot}|${generation}|${version}|${epoch}|${force}`
    const running = inflight.get(id)
    if (running) return running as Promise<T | null>

    const run = (async (): Promise<T | null> => {
      await holds.get(spec.key)
      if (
        store.generation() !== generation ||
        store.version(spec.key) !== version ||
        epochOf(spec.key) !== epoch
      )
        return store.getSlot<T>(spec.key, spec.slot)?.data ?? null
      counts[spec.kind] = (counts[spec.kind] ?? 0) + 1
      const sig = listSigAtStart(spec)
      const gameInfo = spec.runner
        ? deps.getLibraryGame(spec.runner, spec.appName)
        : undefined
      let value: T
      try {
        value = await spec.fetch()
      } catch (error) {
        const previous = store.getSlot<T>(spec.key, spec.slot)
        if (previous && !force) return previous.data
        throw error
      }
      const previous = store.getSlot<T>(spec.key, spec.slot)
      // a Refresh started meanwhile: its own fetch decides what is stored
      if (
        epochOf(spec.key) !== epoch ||
        store.generation() !== generation ||
        store.version(spec.key) !== version
      ) {
        return previous ? previous.data : value
      }
      if (spec.isFailure?.(value, previous?.data)) {
        if (
          force &&
          (spec.failureRejects !== false || previous?.data != null)
        ) {
          throw new FailureShapedResult(spec.kind)
        }
        return previous && previous.data != null ? previous.data : value
      }
      const stored =
        previous && sameData(previous.data, value)
          ? previous.data
          : store.setSlot<T>(spec.key, spec.slot, value).data
      if (gameInfo)
        store.patchEntry(spec.key, (entry) =>
          entry.gameInfo === gameInfo ? entry : { ...entry, gameInfo }
        )
      if (sig) recordListSig(spec.key, sig, spec.slot)
      return stored
    })()
    inflight.set(id, run)
    const forget = () => {
      if (inflight.get(id) === run) inflight.delete(id)
    }
    run.then(forget, forget)
    return run
  }

  async function read<T>(spec: ReadSpec<T>): Promise<T | null> {
    const cached = store.getSlot<T>(spec.key, spec.slot)
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
    const epoch = epochOf(key)
    const generation = store.generation()
    const version = store.version(key)
    const id = `${key}|${generation}|${version}|${epoch}|${!!options.force}`
    const running = wikiInflight.get(id)
    if (running) return running

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
        epochOf(key) !== epoch ||
        store.generation() !== generation ||
        store.version(key) !== version
      )
        return info
      if (!isEmptyWikiInfo(info)) {
        store.patchEntry(key, (entry) =>
          entry.wikiEmpty ? { ...entry, wikiEmpty: 0 } : entry
        )
      } else if (!store.getSlot(key, 'wikiInfo') && deps.isOnline()) {
        // a game that really has no third-party data stops being retried
        const wikiEmpty = (store.getEntry(key)?.wikiEmpty ?? 0) + 1
        store.patchEntry(key, (entry) => ({ ...entry, wikiEmpty }))
        if (wikiEmpty >= WIKI_EMPTY_LIMIT) store.setSlot(key, 'wikiInfo', null)
      }
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
    ) =>
      (await read<GameAchievement[]>({
        kind: 'getAchievements',
        key: detailsKey(runner, appName),
        slot: 'achievements',
        runner,
        appName,
        options,
        fetch: async () => deps.ipc().getAchievements(appName, runner, lang),
        // achievements never disappear: an empty list after a non-empty one
        // is a failed request; GOG returns an empty list offline
        isFailure: (v, previous) =>
          (v ?? []).length === 0 &&
          (!!previous?.length || (runner === 'gog' && !deps.isOnline()))
      })) ?? [],

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
        fetch: async () =>
          deps.getInstallInfo(appName, runner, installPlatform),
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
