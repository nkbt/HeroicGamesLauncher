import type { GameInfo } from 'common/types'
import { indexLibraries, removedGames } from '../librarySync'

const game = { app_name: 'game-a', runner: 'gog' } as GameInfo

test('library reconciliation removes only games absent from a loaded store', () => {
  const libraries = { gog: [game], legendary: [] }
  const games = indexLibraries(libraries)
  expect(games.get('gog:game-a')).toBe(game)
  expect(
    removedGames(
      ['gog:game-a', 'gog:removed', 'legendary:unloaded', 'settings:game-a'],
      libraries,
      games
    )
  ).toEqual(['gog:removed'])
})
