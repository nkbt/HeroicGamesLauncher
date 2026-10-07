import {
  isCompleteGogExtraInfo,
  wrapGogGetExtraInfo
} from 'backend/nk/gameDetails/gogExtraInfoCache'
import { plainGogStoreUrl } from 'backend/nk/gameDetails/plainGogStoreUrl'
import type { ExtraInfo, GameInfo } from 'common/types'

const complete: ExtraInfo = {
  about: { description: 'old', shortDescription: '' },
  reqs: [],
  releaseDate: '2020-01-01T00:00:00',
  storeUrl: 'https://www.gog.com/game/test_game',
  changelog: '<p>1.0</p>'
}
// what upstream returns when the games-data request failed
const failed: ExtraInfo = {
  about: { description: 'old', shortDescription: '' },
  reqs: [],
  releaseDate: undefined,
  storeUrl: undefined,
  changelog: undefined
}

function setup(result: ExtraInfo, online = true) {
  const data = new Map<string, ExtraInfo>()
  const store = {
    get: (k: string) => data.get(k),
    set: (k: string, v: ExtraInfo) => data.set(k, v)
  }
  let language = 'en'
  const original = jest.fn(() => Promise.resolve(result))
  class FakeGame {
    getExtraInfo = undefined as unknown
    getGameInfo() {
      return {
        app_name: 'game-a',
        extra: { about: { description: 'current', shortDescription: '' } }
      } as unknown as GameInfo
    }
  }
  // methods live on the prototype like upstream's class
  const proto = FakeGame.prototype as unknown as {
    getExtraInfo: () => Promise<ExtraInfo>
    getGameInfo: () => GameInfo
  }
  proto.getExtraInfo = original
  const warn = jest.fn()
  const applied = wrapGogGetExtraInfo(proto, {
    store,
    getLanguage: () => language,
    isOnline: () => online,
    warn
  })
  const game = Object.create(proto) as typeof proto
  return {
    applied,
    data,
    original,
    game,
    warn,
    setLanguage: (l: string) => (language = l)
  }
}

describe('wrapGogGetExtraInfo', () => {
  test('a complete result is cached; the next call does no request', async () => {
    const t = setup(complete)
    expect(t.applied).toBe(true)
    await t.game.getExtraInfo()
    const second = await t.game.getExtraInfo()
    expect(t.original).toHaveBeenCalledTimes(1)
    expect(second.storeUrl).toBe(complete.storeUrl)
    // `about` follows the current library entry
    expect(second.about?.description).toBe('current')
  })

  test('a failure-shaped result (games data missing) is not cached', async () => {
    const t = setup(failed)
    await t.game.getExtraInfo()
    await t.game.getExtraInfo()
    expect(t.original).toHaveBeenCalledTimes(2)
    expect(t.data.size).toBe(0)
  })

  test('nothing is cached while offline', async () => {
    const t = setup(complete, false)
    await t.game.getExtraInfo()
    expect(t.data.size).toBe(0)
  })

  test('each UI language is its own entry (changelog language)', async () => {
    const t = setup(complete)
    await t.game.getExtraInfo()
    t.setLanguage('de')
    await t.game.getExtraInfo()
    t.setLanguage('en')
    await t.game.getExtraInfo()
    expect(t.original).toHaveBeenCalledTimes(2)
    expect([...t.data.keys()].sort()).toEqual(['game-a_de', 'game-a_en'])
  })

  test('an unexpected GOGGame shape warns and changes nothing', () => {
    const warn = jest.fn()
    expect(
      wrapGogGetExtraInfo(
        {},
        {
          store: { get: jest.fn(), set: jest.fn() },
          getLanguage: () => 'en',
          isOnline: () => true,
          warn
        }
      )
    ).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

test('isCompleteGogExtraInfo', () => {
  expect(isCompleteGogExtraInfo(complete)).toBe(true)
  expect(isCompleteGogExtraInfo({ ...failed, releaseDate: '2020' })).toBe(true)
  expect(isCompleteGogExtraInfo(failed)).toBe(false)
  expect(isCompleteGogExtraInfo(null)).toBe(false)
})

test('plainGogStoreUrl drops the affiliate host and parameter', () => {
  expect(plainGogStoreUrl('https://af.gog.com/game/test_game?as=123&x=1')).toBe(
    'https://www.gog.com/game/test_game?x=1'
  )
  expect(plainGogStoreUrl('https://www.gog.com/game/test_game')).toBe(
    'https://www.gog.com/game/test_game'
  )
  expect(plainGogStoreUrl(undefined)).toBeUndefined()
  expect(plainGogStoreUrl('not a url')).toBe('not a url')
})

test('concurrent GOG extra-info reads from page and wiki share one request', async () => {
  const t = setup(complete)
  await Promise.all([t.game.getExtraInfo(), t.game.getExtraInfo()])
  expect(t.original).toHaveBeenCalledTimes(1)
})
