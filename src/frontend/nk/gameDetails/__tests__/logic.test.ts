import type { GameInfo, WikiInfo } from 'common/types'
import {
  installPlatformOf,
  isFailureShapedExtraInfo,
  isNotInstallable,
  listSigOf,
  sameData,
  stableStringify,
  wantsInstallInfo,
  wikiForGamePage
} from '../logic'

const game = (over: Partial<GameInfo> = {}) =>
  ({
    app_name: 'game-a',
    runner: 'legendary',
    title: 'Test Game',
    install: {},
    ...over
  }) as GameInfo

test('stableStringify / sameData ignore key order', () => {
  expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
    '{"a":{"c":3,"d":2},"b":1}'
  )
  expect(sameData({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
  expect(sameData({ a: 1 }, { a: 2 })).toBe(false)
  expect(sameData(null, undefined)).toBe(true)
  expect(sameData(null, {})).toBe(false)
})

test('listSigOf: a list rebuilt from identical data has identical signatures', () => {
  const a = game({
    title: 'Test Game',
    is_installed: false,
    art_cover: 'https://img.example/a.jpg',
    extra: { about: { description: 'd', shortDescription: '' }, reqs: [] }
  })
  const rebuilt = JSON.parse(JSON.stringify(a)) as GameInfo
  expect(listSigOf(rebuilt)).toEqual(listSigOf(a))
})

test('listSigOf: each group changes only with its own fields', () => {
  const a = game({
    is_installed: false,
    art_cover: 'https://img.example/a.jpg'
  })
  const base = listSigOf(a)

  const installed = listSigOf({ ...a, is_installed: true } as GameInfo)
  expect(installed.install).not.toBe(base.install)
  expect(installed.meta).toBe(base.meta)
  expect(installed.art).toBe(base.art)

  const renamed = listSigOf({ ...a, title: 'Other Game' } as GameInfo)
  expect(renamed.meta).not.toBe(base.meta)
  expect(renamed.install).toBe(base.install)

  const newArt = listSigOf({
    ...a,
    art_cover: 'https://img.example/b.jpg'
  } as GameInfo)
  expect(newArt.art).not.toBe(base.art)
  expect(newArt.meta).toBe(base.meta)

  // volatile fields are not part of any group
  expect(
    listSigOf({ ...a, is_favourite: true } as unknown as GameInfo)
  ).toEqual(base)
})

test('failure-shaped extra info', () => {
  const ok = { about: { description: 'x', shortDescription: '' }, reqs: [] }
  expect(isFailureShapedExtraInfo(ok, 'legendary')).toBe(false)
  expect(
    isFailureShapedExtraInfo(
      {
        about: { description: '', shortDescription: '' },
        reqs: [],
        storeUrl: ''
      },
      'legendary'
    )
  ).toBe(true)
  expect(isFailureShapedExtraInfo(null, 'legendary')).toBe(true)
  expect(isFailureShapedExtraInfo({ reqs: [] }, 'gog')).toBe(true)
  expect(
    isFailureShapedExtraInfo({ reqs: [], releaseDate: '2020' }, 'gog')
  ).toBe(false)
  // local runners never fail this way
  expect(isFailureShapedExtraInfo(null, 'nile')).toBe(false)
})

test('wikiForGamePage applies the game page gate', () => {
  const steamOnly = {
    pcgamingwiki: null,
    applegamingwiki: null,
    howlongtobeat: null,
    gamesdb: null,
    steamInfo: { compatibilityLevel: 'gold' },
    umuId: null
  } as WikiInfo
  expect(wikiForGamePage(steamOnly)).toBeNull()
  const withHltb = {
    ...steamOnly,
    howlongtobeat: { mainStory: 1, mainExtra: 2, completionist: 3 }
  }
  expect(wikiForGamePage(withHltb)).toBe(withHltb)
  expect(wikiForGamePage(null)).toBeNull()
})

test('installPlatformOf matches GamePage', () => {
  expect(
    installPlatformOf(game({ install: { platform: 'linux' } }), 'linux')
  ).toBe('linux')
  expect(installPlatformOf(game({ is_mac_native: true }), 'darwin')).toBe('Mac')
  expect(installPlatformOf(game({ is_mac_native: true }), 'linux')).toBe(
    'Windows'
  )
})

test('wantsInstallInfo and isNotInstallable', () => {
  expect(wantsInstallInfo(game(), true)).toBe(true)
  expect(wantsInstallInfo(game(), false)).toBe(false)
  expect(wantsInstallInfo(game({ runner: 'sideload' }), true)).toBe(false)
  expect(wantsInstallInfo(game({ thirdPartyManagedApp: 'Origin' }), true)).toBe(
    false
  )
  expect(
    isNotInstallable({ manifest: { disk_size: 0, download_size: 0 } } as never)
  ).toBe(true)
  expect(
    isNotInstallable({ manifest: { disk_size: 1, download_size: 0 } } as never)
  ).toBe(false)
  expect(isNotInstallable(null)).toBe(false)
})
