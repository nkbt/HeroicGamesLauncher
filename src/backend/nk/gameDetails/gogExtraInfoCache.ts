// nk: #5 - persistent cache for GOG `getExtraInfo()`.
//
// Upstream has no cache for it: every game page visit (and the HowLongToBeat
// step of every wiki fetch) costs three GOG API calls. The wrapper is applied
// to `GOGGame.prototype` from initNk(), so gog/games.ts stays untouched.
// Entries never expire (fork cache policy); one game's entries are dropped
// by the invalidation IPC, all of them by "Clear Heroic cache".
// Keyed `${appName}_${language}`: the changelog is fetched in the UI
// language. Pure (dependencies injected) so it can be unit-tested.
import type { ExtraInfo, GameInfo } from 'common/types'

export interface GogExtraInfoStore {
  get: (key: string) => ExtraInfo | undefined
  set: (key: string, value: ExtraInfo) => void
}

export const gogExtraInfoKey = (appName: string, language: string) =>
  `${appName}_${language}`

/**
 * `getExtraInfo` swallows API failures: when the games-data request failed
 * both `storeUrl` and `releaseDate` are missing. Such a result is served but
 * never cached. (`reqs` may legitimately be empty.)
 */
export function isCompleteGogExtraInfo(extra: ExtraInfo | null | undefined) {
  return !!extra && (!!extra.storeUrl || !!extra.releaseDate)
}

interface GogGameLike {
  getExtraInfo: () => Promise<ExtraInfo>
  getGameInfo: () => GameInfo
}

const WRAPPED = Symbol.for('nk.gameDetails.gogExtraInfoWrapped')

export interface GogExtraInfoDeps {
  store: GogExtraInfoStore
  getLanguage: () => string
  isOnline: () => boolean
  warn: (msg: string) => void
}

/**
 * Wraps `proto.getExtraInfo` with a read-through cache. `about` always comes
 * from the current library entry, as upstream reads it from there too.
 * Returns whether the wrapper was applied.
 */
export function wrapGogGetExtraInfo(
  proto: Partial<GogGameLike> | undefined,
  deps: GogExtraInfoDeps
): boolean {
  if (
    !proto ||
    typeof proto.getExtraInfo !== 'function' ||
    typeof proto.getGameInfo !== 'function'
  ) {
    deps.warn('[nk] GOG extra info cache: unexpected GOGGame shape')
    return false
  }
  const target = proto as GogGameLike & { [WRAPPED]?: true }
  if (target[WRAPPED]) return true
  const inflight = new Map<string, Promise<ExtraInfo>>()
  const original = proto.getExtraInfo
  target[WRAPPED] = true

  target.getExtraInfo = async function (this: GogGameLike) {
    const info = this.getGameInfo()
    const key = gogExtraInfoKey(info.app_name, deps.getLanguage())
    const hit = deps.store.get(key)
    if (hit) return { ...hit, about: info.extra?.about }
    const running = inflight.get(key)
    if (running) return running
    const work = original.call(this)
    inflight.set(key, work)
    let extra: ExtraInfo
    try {
      extra = await work
    } finally {
      if (inflight.get(key) === work) inflight.delete(key)
    }
    if (deps.isOnline() && isCompleteGogExtraInfo(extra)) {
      try {
        deps.store.set(key, extra)
      } catch (error) {
        deps.warn(`[nk] GOG extra info cache write failed: ${String(error)}`)
      }
    }
    return extra
  }
  return true
}
