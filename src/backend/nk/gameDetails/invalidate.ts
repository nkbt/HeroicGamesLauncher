// nk: #5 - drops one game's entries from the backend detail caches, so a
// re-fetch (game page Refresh button, a finished install) really fetches
// again instead of answering from upstream's TTL caches. Pure (stores
// injected) so it can be unit-tested.
import type { Runner } from 'common/types'
import type {
  InvalidateGameDetailsResult,
  InvalidateGameDetailsScope
} from 'common/types/nk/gameDetails'
import { deleteByPrefix } from './cacheStoreKeys'

export interface DeletableStore {
  delete: (key: string) => void
}

export interface GameDetailsBackendStores {
  wikiGameInfo: DeletableStore
  umu: DeletableStore
  legendaryGameInfo: DeletableStore
  legendaryInstallInfo: DeletableStore
  gogExtraInfo: DeletableStore
  gogAchievements: DeletableStore
  gogInstallInfo: DeletableStore
  nileInstallInfo: DeletableStore
  zoomInstallInfo: DeletableStore
}

export interface GameIdentity {
  appName: string
  runner: Runner
  /** title as the backend wiki cache keys it (already sanitised) */
  wikiTitle?: string
  /** Epic namespace (legendary extra info is keyed by it) */
  namespace?: string
}

export type InvalidationResult = Pick<
  InvalidateGameDetailsResult,
  'dropped' | 'failed'
>

/** Deletes the game's `scope` entries; reports which caches were cleared. */
export function invalidateBackendCaches(
  { appName, runner, wikiTitle, namespace }: GameIdentity,
  scope: InvalidateGameDetailsScope,
  stores: GameDetailsBackendStores,
  warn: (msg: string) => void
): InvalidationResult {
  const result: InvalidationResult = { dropped: [], failed: [] }

  function drop(name: string, store: DeletableStore, key: string) {
    try {
      store.delete(key)
      result.dropped.push(name)
    } catch (error) {
      warn(`[nk] game details: clearing ${name} failed: ${String(error)}`)
      result.failed.push(name)
    }
  }

  function dropPrefix(name: string, store: DeletableStore, prefix: string) {
    try {
      if (deleteByPrefix(store, prefix) === null) {
        warn(`[nk] game details: cannot list the keys of ${name}`)
        result.failed.push(name)
        return
      }
      result.dropped.push(name)
    } catch (error) {
      warn(`[nk] game details: clearing ${name} failed: ${String(error)}`)
      result.failed.push(name)
    }
  }

  if (runner === 'sideload') return result

  if (scope === 'meta' || scope === 'all') {
    if (wikiTitle) drop('wikigameinfo', stores.wikiGameInfo, wikiTitle)
    drop('umu', stores.umu, `${runner}_${appName}`)
    if (runner === 'legendary' && namespace) {
      drop('legendary_gameinfo', stores.legendaryGameInfo, namespace)
    }
    if (runner === 'gog') {
      // keyed `${appName}_${language}`: every language variant goes
      dropPrefix('nk_gog_extra_info', stores.gogExtraInfo, `${appName}_`)
    }
  }

  if (scope === 'install' || scope === 'all') {
    switch (runner) {
      case 'legendary':
        drop('legendary_install_info', stores.legendaryInstallInfo, appName)
        break
      case 'gog':
        // keyed `${appName}_${platform}_${branch}_${build}_${branchPassword}`
        dropPrefix('gog_install_info', stores.gogInstallInfo, `${appName}_`)
        break
      case 'nile':
        drop('nile_install_info', stores.nileInstallInfo, appName)
        break
      case 'zoom':
        drop('zoom_install_info', stores.zoomInstallInfo, appName)
        break
    }
  }

  if ((scope === 'all' || scope === 'achievements') && runner === 'gog') {
    drop('gog_achievements', stores.gogAchievements, appName)
  }

  return result
}
