import type { GameInfo } from 'common/types'
import {
  changedGameKeys,
  gameKey,
  shareGameList
} from 'frontend/nk/librarySharing'

function game(
  app_name: string,
  extra: Partial<GameInfo> = {},
  runner: GameInfo['runner'] = 'legendary'
): GameInfo {
  return {
    app_name,
    runner,
    title: `Test Game ${app_name}`,
    art_square: `https://img.example.test/${app_name}.jpg`,
    art_cover: '',
    install: { is_dlc: false, platform: 'Windows' },
    is_installed: false,
    canRunOffline: false,
    ...extra
  } as GameInfo
}

describe('gameKey', () => {
  test('is runner:app_name', () => {
    expect(gameKey(game('game-a', {}, 'gog'))).toBe('gog:game-a')
  })
})

describe('shareGameList', () => {
  test('an equal list returns the previous array', () => {
    const prev = [game('game-a'), game('game-b')]
    expect(shareGameList(prev, [game('game-a'), game('game-b')])).toBe(prev)
  })

  test('without a previous list the next list is returned', () => {
    const next = [game('game-a')]
    expect(shareGameList(undefined, next)).toBe(next)
  })

  test('one changed item: new array, every other item is the previous object', () => {
    const prev = [game('game-a'), game('game-b'), game('game-c')]
    const next = [
      game('game-a'),
      game('game-b', { is_installed: true }),
      game('game-c')
    ]
    const shared = shareGameList(prev, next)
    expect(shared).not.toBe(prev)
    expect(shared[0]).toBe(prev[0])
    expect(shared[1]).toBe(next[1])
    expect(shared[2]).toBe(prev[2])
  })

  test('a reordered list: new array with the previous objects', () => {
    const prev = [game('game-a'), game('game-b')]
    const shared = shareGameList(prev, [game('game-b'), game('game-a')])
    expect(shared).not.toBe(prev)
    expect(shared[0]).toBe(prev[1])
    expect(shared[1]).toBe(prev[0])
  })

  test('added and removed games', () => {
    const prev = [game('game-a'), game('game-b')]
    const added = shareGameList(prev, [
      game('game-new'),
      game('game-a'),
      game('game-b')
    ])
    expect(added).toHaveLength(3)
    expect(added[1]).toBe(prev[0])
    expect(added[2]).toBe(prev[1])

    const removed = shareGameList(prev, [game('game-b')])
    expect(removed).toEqual([prev[1]])
    expect(removed[0]).toBe(prev[1])
  })

  test('an override change counts as a change', () => {
    const prev = [game('game-a')]
    const next = [
      game('game-a', {
        overrides: { art_square: 'https://img.example.test/custom.jpg' }
      } as Partial<GameInfo>)
    ]
    const shared = shareGameList(prev, next)
    expect(shared).not.toBe(prev)
    expect(shared[0]).toBe(next[0])
  })

  test('the same app name in another store is a different game', () => {
    const prev = [game('game-a')]
    const next = [game('game-a', {}, 'gog')]
    expect(shareGameList(prev, next)[0]).toBe(next[0])
  })
})

describe('changedGameKeys', () => {
  test('reports exactly the added, removed and changed keys', () => {
    const prev = [
      game('game-a'),
      game('game-b'),
      game('game-c'),
      game('game-d', {}, 'gog')
    ]
    const next = [
      game('game-c'), // moved, unchanged
      game('game-a', { title: 'Renamed Game' }), // changed
      game('game-e', {}, 'nile'), // added
      game('game-d', {}, 'gog') // unchanged
      // game-b removed
    ]
    expect(changedGameKeys(prev, next)).toEqual(
      new Set(['legendary:game-a', 'legendary:game-b', 'nile:game-e'])
    )
  })

  test('an unchanged list has no changed keys', () => {
    const prev = [game('game-a'), game('game-b')]
    expect(changedGameKeys(prev, [game('game-b'), game('game-a')]).size).toBe(0)
  })

  test('without a previous list every game is added', () => {
    expect(changedGameKeys(undefined, [game('game-a')])).toEqual(
      new Set(['legendary:game-a'])
    )
  })
})
