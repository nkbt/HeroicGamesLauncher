// nk: #5 - React side of the game details cache.
// The `use...State` hooks replace a component's `useState` for one piece of
// game data: they start from the cached value (so a cached page renders
// complete in its first frame) and follow later writes of that slot
// (Refresh, local events), so an open page updates in place. The returned
// setter is the component's own, so upstream effects keep working
// unchanged. A dropped slot keeps the shown value until it is re-filled.
import {
  type Dispatch,
  useCallback,
  type SetStateAction,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import { useStore } from 'zustand'
import i18next, { type TFunction } from 'i18next'
import type {
  AntiCheatInfo,
  AppSettings,
  ExtraInfo,
  GameAchievement,
  GameInfo,
  GameSettings,
  InstallInfo,
  KnownFixesInfo,
  LaunchOption,
  Runner,
  Status,
  WikiInfo
} from 'common/types'
import { getStatusLabel } from 'frontend/hooks/constants'
import ContextProvider from 'frontend/state/ContextProvider'
import { gameDetailsApi, gameDetailsStore, syncLibraries } from './instance'
import { installPlatformOf, isNotInstallable, wikiForGamePage } from './logic'
import { refreshState } from './refresh'
import { peekStatus, subscribeStatus } from './statusMemo'
import {
  detailsKey,
  type DetailsKey,
  extraInfoSlot,
  installInfoSlot,
  settingsKey,
  type SlotId
} from './types'

/**
 * Local state seeded from a cached slot and updated on every later write of
 * it. `fromSlot` maps the slot data to the state, or `undefined` to keep the
 * current state.
 */
function useCachedState<T>(
  key: DetailsKey | null,
  slot: SlotId,
  fromSlot: (data: unknown) => T | undefined,
  fallback: () => T
): [T, Dispatch<SetStateAction<T>>] {
  const fromSlotRef = useRef(fromSlot)
  fromSlotRef.current = fromSlot
  const seenRef = useRef(key ? gameDetailsStore.getSlot(key, slot) : undefined)
  const selection = useRef({ key, slot })
  const [value, setValue] = useState<T>(() => {
    const cached = seenRef.current
    const seeded = cached ? fromSlot(cached.data) : undefined
    return seeded === undefined ? fallback() : seeded
  })

  if (selection.current.key !== key || selection.current.slot !== slot) {
    selection.current = { key, slot }
    const cached = key ? gameDetailsStore.getSlot(key, slot) : undefined
    seenRef.current = cached
    const seeded = cached ? fromSlot(cached.data) : undefined
    setValue(seeded === undefined ? fallback() : seeded)
  }

  useEffect(() => {
    if (!key) return
    const follow = () => {
      const current = gameDetailsStore.getSlot(key, slot)
      if (current === seenRef.current) return
      seenRef.current = current
      if (!current) return
      const next = fromSlotRef.current(current.data)
      if (next !== undefined) setValue(next)
    }
    follow() // a write between the first render and this effect
    return gameDetailsStore.state.subscribe(follow)
  }, [key, slot])

  const selectedSetter = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      if (selection.current.key === key && selection.current.slot === slot)
        setValue(next)
    },
    [key, slot]
  )
  return [value, selectedSetter]
}

/** GamePage wiki data; upstream only shows PCGW/HLTB/AppleGamingWiki data. */
export function useWikiInfoState(runner: Runner, appName: string) {
  return useCachedState<WikiInfo | null>(
    detailsKey(runner, appName),
    'wikiInfo',
    (data) => wikiForGamePage(data as WikiInfo | null),
    () => null
  )
}

export function useGameSettingsState(appName: string) {
  return useCachedState<GameSettings | null>(
    settingsKey(appName),
    'settings',
    (data) => (data as GameSettings | null) ?? undefined,
    () => null
  )
}

/** Extra info in the UI language; the library entry's until it is cached. */
export function useExtraInfoState(gameInfo: GameInfo) {
  const language = i18next.language ?? ''
  const state = useCachedState<ExtraInfo | null>(
    detailsKey(gameInfo.runner, gameInfo.app_name),
    extraInfoSlot(language),
    (data) => (data as ExtraInfo | null) ?? undefined,
    () => gameInfo.extra || null
  )
  useEffect(() => {
    gameDetailsApi
      .getExtraInfo(gameInfo.app_name, gameInfo.runner)
      .catch((error) => console.warn('[nk] extra info:', error))
  }, [gameInfo.app_name, gameInfo.runner, language])
  return state
}

export function useAchievementsState(runner: Runner, appName: string) {
  return useCachedState<GameAchievement[]>(
    detailsKey(runner, appName),
    'achievements',
    (data) => (data as GameAchievement[] | null) ?? [],
    () => []
  )
}

/** Install info of the platform the game page asks for. */
export function useInstallInfoState(gameInfo: GameInfo) {
  const { platform } = useContext(ContextProvider)
  return useCachedState<InstallInfo | null>(
    detailsKey(gameInfo.runner, gameInfo.app_name),
    installInfoSlot(installPlatformOf(gameInfo, platform)),
    (data) => {
      const info = data as InstallInfo | null
      return info && !isNotInstallable(info) ? info : undefined
    },
    () => null
  )
}

export function useNotInstallableState(gameInfo: GameInfo) {
  const { platform } = useContext(ContextProvider)
  return useCachedState<boolean>(
    detailsKey(gameInfo.runner, gameInfo.app_name),
    installInfoSlot(installPlatformOf(gameInfo, platform)),
    (data) => isNotInstallable(data as InstallInfo | null),
    () => false
  )
}

export function useAnticheatState(gameInfo: GameInfo) {
  return useCachedState<AntiCheatInfo | null>(
    detailsKey(gameInfo.runner, gameInfo.app_name),
    'anticheat',
    (data) => data as AntiCheatInfo | null,
    () => null
  )
}

export function useLaunchOptionsState(
  runner: Runner | undefined,
  appName: string
) {
  return useCachedState<LaunchOption[]>(
    runner ? detailsKey(runner, appName) : null,
    'launchOptions',
    (data) => (data as LaunchOption[] | null) ?? [],
    () => []
  )
}

/** useSettingsContext's config: the cached game settings (not app config). */
export function useSettingsConfigState(appName: string) {
  return useCachedState<Partial<AppSettings>>(
    appName === 'default' ? null : settingsKey(appName),
    'settings',
    (data) => (data as Partial<AppSettings> | null) ?? undefined,
    () => ({})
  )
}

/**
 * Known fixes of a game, cached. Replaces upstream's
 * `useAwaited(window.api.getKnownFixes, appName, runner)`, whose effect
 * re-ran after every render (its rest-args array is new each time): for a
 * game with known fixes every result was a new object, so the page
 * re-rendered and re-requested in a loop.
 */
export function useKnownFixes(appName: string, runner: Runner) {
  const [knownFixes] = useCachedState<KnownFixesInfo | null>(
    detailsKey(runner, appName),
    'knownFixes',
    (data) => data as KnownFixesInfo | null,
    () => null
  )
  useEffect(() => {
    gameDetailsApi
      .getKnownFixes(appName, runner)
      .catch((error) => console.warn('[nk] known fixes:', error))
  }, [appName, runner])
  return knownFixes
}

/** hasStatus: the remembered status with its label recomputed. */
export function seedGameStatus(
  gameInfo: GameInfo,
  t: TFunction<'gamepage', undefined>
): {
  status?: Status
  statusContext?: string
  folder?: string
  label: string
} {
  const { app_name: appName, runner } = gameInfo
  const remembered = peekStatus(appName)
  let fallback: Status = gameInfo.is_installed ? 'installed' : 'notInstalled'
  if (gameInfo.thirdPartyManagedApp) {
    fallback =
      !gameInfo.isEAManaged && !gameInfo.isUbisoftManaged
        ? 'notSupportedGame'
        : 'notInstalled'
  }
  const { status = fallback, folder, statusContext } = remembered ?? {}
  return {
    status,
    folder,
    statusContext,
    label: getStatusLabel({
      status,
      t,
      runner: runner ?? 'sideload',
      statusContext
    })
  }
}

/**
 * Keeps the cache in step with the library lists (game list entries for
 * the list signatures; details of removed games are dropped).
 */
export function useLibrarySync() {
  const { epic, gog, amazon, zoom, sideloadedLibrary } =
    useContext(ContextProvider)
  const hydrated = useStore(gameDetailsStore.state, (s) => s.hydrated)
  useEffect(() => {
    syncLibraries({
      legendary: epic.library,
      gog: gog.library,
      nile: amazon.library,
      zoom: zoom.library,
      sideload: sideloadedLibrary
    })
  }, [
    hydrated,
    epic.library,
    gog.library,
    amazon.library,
    zoom.library,
    sideloadedLibrary
  ])
}

export function useRefreshProgress(runner: Runner, appName: string) {
  return useStore(refreshState, (s) => s.running[detailsKey(runner, appName)])
}

/** Failed steps of this game's last finished Refresh (0: none). */
export function useRefreshFailed(runner: Runner, appName: string) {
  return useStore(
    refreshState,
    (s) => s.failed[detailsKey(runner, appName)] ?? 0
  )
}

/** Refresh publishes this game's remembered status directly, without another availability request. */
export function useGameStatusState(
  gameInfo: GameInfo,
  t: TFunction<'gamepage', undefined>
) {
  const [gameStatus, setGameStatus] = useState(() =>
    seedGameStatus(gameInfo, t)
  )
  useEffect(
    () =>
      subscribeStatus(gameInfo.app_name, () =>
        setGameStatus(seedGameStatus(gameInfo, t))
      ),
    [gameInfo, t]
  )
  return [gameStatus, setGameStatus] as const
}

/** The submenu derives its link from the same per-game wiki slot. */
export function useProtonDBurlState(
  runner: Runner,
  appName: string,
  title: string
) {
  return useCachedState<string>(
    detailsKey(runner, appName),
    'wikiInfo',
    (data) => {
      const info = data as WikiInfo | null
      const steamID = info?.pcgamingwiki?.steamID ?? info?.gamesdb?.steamID
      return steamID
        ? `https://www.protondb.com/app/${steamID}`
        : `https://www.protondb.com/search?q=${title}`
    },
    () => `https://www.protondb.com/search?q=${title}`
  )
}
