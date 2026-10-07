import type { Game } from 'common/types/game_manager'
import type { WikiInfo } from 'common/types'
import { dedupeWiki } from '../gameDetails/dedupeWiki'

jest.mock('backend/utils', () => ({
  removeSpecialcharacters: (title: string) => title.replace(/\W/g, '')
}))

test('direct backend callers with one sanitised title share the full fetch', async () => {
  let resolve!: (info: WikiInfo | null) => void
  const fetchWiki = jest.fn(
    () =>
      new Promise<WikiInfo | null>((release) => {
        resolve = release
      })
  )
  const getWikiGameInfo = dedupeWiki(fetchWiki)
  const firstGame = {
    getGameInfo: () => ({
      runner: 'gog',
      app_name: 'game-a',
      title: 'Synthetic Game'
    })
  } as unknown as Game
  const secondGame = {
    getGameInfo: () => ({
      runner: 'legendary',
      app_name: 'game-b',
      title: 'Synthetic Game!'
    })
  } as unknown as Game
  const first = getWikiGameInfo(firstGame)
  const second = getWikiGameInfo(secondGame)
  expect(fetchWiki).toHaveBeenCalledTimes(1)
  resolve(null)
  await Promise.all([first, second])
})
