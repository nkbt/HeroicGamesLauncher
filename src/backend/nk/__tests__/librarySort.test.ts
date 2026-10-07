import { normaliseEpoch, sortGamesByDateAdded } from 'common/nk/librarySort'
import type { GameInfo, Runner } from 'common/types'
import type { LibraryDateEntry } from 'common/types/nk/libraryDates'

const game = (app_name: string, runner: Runner = 'legendary') =>
  ({ app_name, runner, title: app_name }) as GameInfo

const entry = (added: number): LibraryDateEntry => ({
  added,
  source: 'first-seen'
})

const names = (games: GameInfo[]) => games.map((g) => g.app_name)

describe('sortGamesByDateAdded', () => {
  const games = [game('a'), game('b', 'gog'), game('c', 'nile'), game('d')]
  const dates = {
    a_legendary: entry(100),
    b_gog: entry(300),
    c_nile: entry(200),
    d_legendary: entry(50)
  }

  test('newest first', () => {
    expect(names(sortGamesByDateAdded(games, dates, true))).toEqual([
      'b',
      'c',
      'a',
      'd'
    ])
  })

  test('oldest first', () => {
    expect(names(sortGamesByDateAdded(games, dates, false))).toEqual([
      'd',
      'a',
      'c',
      'b'
    ])
  })

  test('does not mutate the input', () => {
    const copy = [...games]
    sortGamesByDateAdded(games, dates, true)
    expect(games).toEqual(copy)
  })

  test('ties keep input order (stable) in both directions', () => {
    const tied = [game('x'), game('y'), game('z'), game('w')]
    const d = {
      x_legendary: entry(10),
      y_legendary: entry(10),
      z_legendary: entry(10),
      w_legendary: entry(5)
    }
    expect(names(sortGamesByDateAdded(tied, d, true))).toEqual([
      'x',
      'y',
      'z',
      'w'
    ])
    expect(names(sortGamesByDateAdded(tied, d, false))).toEqual([
      'w',
      'x',
      'y',
      'z'
    ])
  })

  test('missing dates go to the top in newest-first and bottom in oldest-first', () => {
    const list = [game('m1'), game('a'), game('m2'), game('d')]
    expect(names(sortGamesByDateAdded(list, dates, true))).toEqual([
      'm1',
      'm2',
      'a',
      'd'
    ])
    expect(names(sortGamesByDateAdded(list, dates, false))).toEqual([
      'd',
      'a',
      'm1',
      'm2'
    ])
  })

  test('several missing / invalid dates never produce NaN comparisons', () => {
    const list = [game('m1'), game('m2'), game('m3'), game('a')]
    const d = {
      a_legendary: entry(1),
      m2_legendary: { added: NaN, source: 'seed' } as LibraryDateEntry,
      m3_legendary: { added: Infinity, source: 'seed' } as LibraryDateEntry
    }
    expect(names(sortGamesByDateAdded(list, d, true))).toEqual([
      'm1',
      'm2',
      'm3',
      'a'
    ])
    expect(names(sortGamesByDateAdded(list, d, false))).toEqual([
      'a',
      'm1',
      'm2',
      'm3'
    ])
  })

  test('the runner is part of the key', () => {
    const list = [game('same', 'gog'), game('same', 'legendary')]
    const d = { same_legendary: entry(2), same_gog: entry(1) }
    expect(sortGamesByDateAdded(list, d, true).map((g) => g.runner)).toEqual([
      'legendary',
      'gog'
    ])
  })
})

describe('normaliseEpoch', () => {
  const now = Date.parse('2026-10-06T00:00:00Z')

  test('ISO strings', () => {
    expect(normaliseEpoch('2019-06-15T12:30:45.123Z', now)).toBe(
      Date.parse('2019-06-15T12:30:45.123Z')
    )
  })

  test('ms numbers and ms strings (Amazon)', () => {
    expect(normaliseEpoch(1577836800123, now)).toBe(1577836800123)
    expect(normaliseEpoch('1577836800123', now)).toBe(1577836800123)
  })

  test('seconds (GOG) are converted to ms', () => {
    expect(normaliseEpoch(1577836800, now)).toBe(1577836800000)
    expect(normaliseEpoch('1577836800', now)).toBe(1577836800000)
  })

  test('null, undefined, 0, negative, NaN and garbage are rejected', () => {
    expect(normaliseEpoch(null, now)).toBeUndefined()
    expect(normaliseEpoch(undefined, now)).toBeUndefined()
    expect(normaliseEpoch(0, now)).toBeUndefined()
    expect(normaliseEpoch(-5, now)).toBeUndefined()
    expect(normaliseEpoch(NaN, now)).toBeUndefined()
    expect(normaliseEpoch('', now)).toBeUndefined()
    expect(normaliseEpoch('not a date', now)).toBeUndefined()
  })

  test('more than one day in the future is rejected', () => {
    expect(normaliseEpoch(now + 2 * 86400000, now)).toBeUndefined()
    expect(normaliseEpoch(now + 3600000, now)).toBe(now + 3600000)
  })
})
