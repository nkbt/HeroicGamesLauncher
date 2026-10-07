// nk: #5 - pure helpers of the game details cache (no React, no DOM, no IPC).
import type {
  ExtraInfo,
  GameInfo,
  InstallInfo,
  Runner,
  WikiInfo
} from 'common/types'
import type { ListSig } from './types'

/** JSON with object keys sorted, so equal data gives equal text. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(v).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k]
      }
      return sorted
    }
    return v
  })
}

/** Deep equality of JSON-shaped data (IPC results). */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a == null || b == null) return a == b // null and undefined: both "none"
  return stableStringify(a) === stableStringify(b)
}

function hash(text: string): string {
  // FNV-1a, plus the length
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16)}.${text.length}`
}

/**
 * Signatures of the library list fields a game's details depend on, in
 * three groups. Volatile fields (status, progress, ...) are not included.
 */
export function listSigOf(game: GameInfo): Required<ListSig> {
  const { extra, install } = game
  return {
    meta: hash(
      stableStringify([
        game.title,
        game.namespace,
        extra?.about?.description,
        extra?.genres,
        extra?.releaseDate,
        install?.is_dlc
      ])
    ),
    install: hash(
      stableStringify([
        game.is_installed,
        install?.platform,
        install?.version,
        install?.install_path,
        game.thirdPartyManagedApp,
        game.canRunOffline
      ])
    ),
    art: hash(
      stableStringify([
        game.art_cover,
        game.art_square,
        game.art_logo,
        game.art_background
      ])
    )
  }
}

/**
 * Upstream getExtraInfo swallows failures and returns an empty-looking
 * result instead of throwing (Epic: no description, no reqs, no store URL;
 * GOG: no store URL and no release date). Such a result never replaces good
 * cached data and is not cached itself.
 */
export function isFailureShapedExtraInfo(
  extra: ExtraInfo | null | undefined,
  runner: Runner
): boolean {
  if (runner !== 'legendary' && runner !== 'gog') return false
  if (!extra) return true
  if (runner === 'gog') return !extra.storeUrl && !extra.releaseDate
  return (
    !extra.about?.description &&
    !extra.about?.shortDescription &&
    (extra.reqs ?? []).length === 0 &&
    !extra.storeUrl
  )
}

/** Every wiki source came back empty (likely a network failure). */
export function isEmptyWikiInfo(info: WikiInfo | null | undefined): boolean {
  if (!info) return true
  return (
    !info.pcgamingwiki &&
    !info.howlongtobeat &&
    !info.applegamingwiki &&
    !info.steamInfo &&
    !info.gamesdb?.steamID
  )
}

/** The game page's own gate for showing wiki data (GamePage index.tsx). */
export function wikiForGamePage(
  info: WikiInfo | null | undefined
): WikiInfo | null {
  return info &&
    (info.applegamingwiki || info.howlongtobeat || info.pcgamingwiki)
    ? info
    : null
}

/** Install platform exactly as GamePage's updateConfig computes it. */
export function installPlatformOf(gameInfo: GameInfo, platform: string) {
  const { install, is_mac_native = undefined } = gameInfo
  return (
    install?.platform ||
    (is_mac_native && platform === 'darwin' ? 'Mac' : 'Windows')
  )
}

/** GamePage's conditions for requesting install info at all. */
export function wantsInstallInfo(gameInfo: GameInfo, online: boolean) {
  return (
    gameInfo.runner !== 'sideload' && !gameInfo.thirdPartyManagedApp && online
  )
}

export function isNotInstallable(info: InstallInfo | null | undefined) {
  return (
    !!info?.manifest &&
    info.manifest.disk_size === 0 &&
    info.manifest.download_size === 0
  )
}
