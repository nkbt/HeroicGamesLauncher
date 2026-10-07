// nk: #5 - library list -> game details (pure, no React).
// - `libraryGames`: the current library list entry of every game, so a
//   detail fetch can record which list data it was fetched with.
// - `removedGames`: cached games that disappeared from a loaded store
//   library; their entries are dropped. A store whose list is empty may just
//   not be loaded yet, so its entries are kept.
// Re-updating games whose list data changed is not done here.
import type { GameInfo, Runner } from 'common/types'
import { detailsKey, type DetailsKey } from './types'

export type Libraries = Partial<Record<Runner, GameInfo[]>>

export function indexLibraries(libraries: Libraries) {
  const games = new Map<DetailsKey, GameInfo>()
  for (const list of Object.values(libraries)) {
    for (const game of list ?? []) {
      games.set(detailsKey(game.runner, game.app_name), game)
    }
  }
  return games
}

export function removedGames(
  keys: DetailsKey[],
  libraries: Libraries,
  games: Map<DetailsKey, GameInfo>
): DetailsKey[] {
  const loaded = new Set<string>()
  for (const [runner, list] of Object.entries(libraries)) {
    if (list?.length) loaded.add(runner)
  }
  return keys.filter((key) => {
    const separator = key.indexOf(':')
    const runner = key.slice(0, separator)
    // settings entries are keyed `settings:<appName>`, not by runner
    return loaded.has(runner) && !games.has(key)
  })
}
