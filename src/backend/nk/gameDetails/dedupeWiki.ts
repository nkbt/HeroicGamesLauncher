// nk: #5 - both direct backend callers and renderer IPC share one wiki
// fetch per sanitised title, and wait for a per-game cache invalidation.
import type { Game } from 'common/types/game_manager'
import type { WikiInfo } from 'common/types'
import { removeSpecialcharacters } from 'backend/utils'
import { createInflight } from './wikiInfo'
import { requestBarrier } from './requestBarrier'

export const wikiInflight = createInflight<WikiInfo | null>()

export function dedupeWiki(
  fetchWiki: (game: Game) => Promise<WikiInfo | null>
) {
  return (game: Game) => {
    const gameInfo = game.getGameInfo()
    const key = removeSpecialcharacters(gameInfo.title)
    return requestBarrier.run(`${gameInfo.runner}:${gameInfo.app_name}`, () =>
      wikiInflight.run(key, () => fetchWiki(game))
    )
  }
}
