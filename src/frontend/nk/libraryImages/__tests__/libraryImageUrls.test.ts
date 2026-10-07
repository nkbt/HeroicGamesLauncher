import type { GameInfo } from 'common/types'
import {
  getLibraryCardImageUrls,
  orderForPrefetch,
  takeUnsentUrls
} from 'frontend/nk/libraryImages/libraryImageUrls'

function game(partial: Partial<GameInfo> & { app_name: string }): GameInfo {
  return {
    runner: 'gog',
    title: 'Test Game',
    art_square: `https://img.example.test/${partial.app_name}.jpg`,
    art_cover: '',
    install: {},
    is_installed: false,
    canRunOffline: false,
    ...partial
  } as GameInfo
}

describe('getLibraryCardImageUrls', () => {
  test('legendary covers get the card resize suffix, others are unchanged', () => {
    expect(
      getLibraryCardImageUrls([
        game({ app_name: 'game-a', runner: 'legendary' }),
        game({ app_name: 'game-b', runner: 'gog' }),
        game({ app_name: 'game-c', runner: 'nile' })
      ])
    ).toEqual([
      'https://img.example.test/game-a.jpg?h=400&resize=1&w=300',
      'https://img.example.test/game-b.jpg',
      'https://img.example.test/game-c.jpg'
    ])
  })

  test('logos are added except for nile, from the raw art_logo', () => {
    expect(
      getLibraryCardImageUrls([
        game({
          app_name: 'game-a',
          runner: 'legendary',
          art_logo: 'https://img.example.test/logo-a.png'
        }),
        game({
          app_name: 'game-c',
          runner: 'nile',
          art_logo: 'https://img.example.test/logo-c.png'
        })
      ])
    ).toEqual([
      'https://img.example.test/game-a.jpg?h=400&resize=1&w=300',
      'https://img.example.test/logo-a.png?h=400&resize=1&w=300',
      'https://img.example.test/game-c.jpg'
    ])
  })

  test('overridden cover first, plus the original cover (console mode)', () => {
    expect(
      getLibraryCardImageUrls([
        game({
          app_name: 'game-a',
          runner: 'legendary',
          overrides: { art_square: 'https://grid.example.test/custom.png' }
        })
      ])
    ).toEqual([
      'https://grid.example.test/custom.png?h=400&resize=1&w=300',
      'https://img.example.test/game-a.jpg?h=400&resize=1&w=300'
    ])
  })

  test('skips DLCs, fallback art, local paths; dedupes in order', () => {
    expect(
      getLibraryCardImageUrls([
        game({ app_name: 'dlc', install: { is_dlc: true } }),
        game({ app_name: 'fb', art_square: 'fallback' }),
        game({ app_name: 'none', art_square: '' }),
        game({
          app_name: 'local',
          runner: 'sideload',
          art_square: '/images/x.png'
        }),
        game({
          app_name: 'dup-1',
          art_square: 'https://img.example.test/same.jpg'
        }),
        game({
          app_name: 'dup-2',
          art_square: 'https://img.example.test/same.jpg'
        })
      ])
    ).toEqual(['https://img.example.test/same.jpg'])
  })
})

describe('orderForPrefetch', () => {
  test('installed and favourites first, stable', () => {
    const games = [
      game({ app_name: 'a' }),
      game({ app_name: 'b', is_installed: true }),
      game({ app_name: 'c' }),
      game({ app_name: 'd' })
    ]
    expect(
      orderForPrefetch(games, new Set(['d'])).map((g) => g.app_name)
    ).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('takeUnsentUrls', () => {
  const list = ['https://x/1', 'https://x/2', 'https://x/3']

  test('first call returns everything, a repeat returns nothing', () => {
    const sent = new Set<string>()
    expect(takeUnsentUrls(sent, list)).toEqual(list)
    expect(takeUnsentUrls(sent, [...list])).toEqual([])
  })

  test('one changed URL is the only one returned', () => {
    const sent = new Set<string>()
    takeUnsentUrls(sent, list)
    expect(
      takeUnsentUrls(sent, ['https://x/1', 'https://x/2-new', 'https://x/3'])
    ).toEqual(['https://x/2-new'])
  })

  test('a reordered list returns nothing', () => {
    const sent = new Set<string>()
    takeUnsentUrls(sent, list)
    expect(takeUnsentUrls(sent, [...list].reverse())).toEqual([])
  })
})
