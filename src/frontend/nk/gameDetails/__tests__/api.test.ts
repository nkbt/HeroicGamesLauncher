import type { GameInfo, Runner } from 'common/types'
import { getInstallInfo } from 'frontend/helpers'
import {
  createGameDetailsApi,
  type DetailsIpc,
  FailureShapedResult,
  WIKI_EMPTY_LIMIT
} from '../api'
import { listSigOf } from '../logic'
import { MemoryPersistence } from '../persistence'
import { createGameDetailsStore } from '../store'

const goodExtra = {
  about: { description: 'A test game.', shortDescription: '' },
  reqs: [],
  storeUrl: 'https://store.example/test-game'
}
const failedExtra = {
  about: { description: '', shortDescription: '' },
  reqs: [],
  storeUrl: ''
}
const wiki = {
  pcgamingwiki: null,
  applegamingwiki: null,
  howlongtobeat: { mainStory: 1, mainExtra: 2, completionist: 3 },
  gamesdb: null,
  steamInfo: null,
  umuId: null
}
const emptyWiki = { ...wiki, howlongtobeat: null }

const libraryGame = {
  app_name: 'game-a',
  runner: 'legendary',
  title: 'Test Game',
  is_installed: false,
  install: {},
  art_cover: 'https://img.example/a.jpg'
} as unknown as GameInfo

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function setup({ online = true, language = 'en', platform = 'linux' } = {}) {
  const store = createGameDetailsStore(new MemoryPersistence(), {
    scheduleNotify: () => undefined,
    warn: jest.fn()
  })
  const ipc = {
    getExtraInfo: jest.fn(() => Promise.resolve(goodExtra)),
    getWikiGameInfo: jest.fn(() => Promise.resolve(wiki)),
    getAchievements: jest.fn(() => Promise.resolve([])),
    requestGameSettings: jest.fn(() => Promise.resolve({ wineVersion: 'w' })),
    getAnticheatInfo: jest.fn(() => Promise.resolve(undefined)),
    getKnownFixes: jest.fn(() => Promise.resolve(undefined)),
    getLaunchOptions: jest.fn(() => Promise.resolve([])),
    clearAchievementCache: jest.fn()
  }
  const installInfo = jest.fn(() =>
    Promise.resolve({
      manifest: { disk_size: 2, download_size: 1 }
    })
  )
  let game: GameInfo | undefined = libraryGame
  const state = { language, online }
  const gameDetailsApi = createGameDetailsApi(store, {
    ipc: () => ipc as unknown as DetailsIpc,
    getInstallInfo: installInfo as never,
    platform,
    getLanguage: () => state.language,
    isOnline: () => state.online,
    getLibraryGame: () => game
  })
  return {
    gameDetailsApi,
    store,
    ipc,
    installInfo,
    state,
    setLibraryGame: (g: GameInfo | undefined) => (game = g)
  }
}

const runner: Runner = 'legendary'

describe('filled slots', () => {
  test('resolve the stored object with zero IPC, also after list data changed', async () => {
    const t = setup()
    const first = await t.gameDetailsApi.getExtraInfo('game-a', runner)
    t.setLibraryGame({ ...libraryGame, title: 'Renamed' } as GameInfo)
    const second = await t.gameDetailsApi.getExtraInfo('game-a', runner)
    expect(second).toBe(first)
    expect(t.ipc.getExtraInfo).toHaveBeenCalledTimes(1)
    expect(t.gameDetailsApi.stats()).toEqual({ getExtraInfo: 1 })
  })

  test('cached "none" (undefined from the backend) is not fetched again', async () => {
    const t = setup()
    expect(await t.gameDetailsApi.getKnownFixes('game-a', runner)).toBeNull()
    expect(
      await t.gameDetailsApi.getAnticheatInfo('ns-1', runner, 'game-a')
    ).toBeNull()
    await t.gameDetailsApi.getKnownFixes('game-a', runner)
    await t.gameDetailsApi.getAnticheatInfo('ns-1', runner, 'game-a')
    expect(t.ipc.getKnownFixes).toHaveBeenCalledTimes(1)
    expect(t.ipc.getAnticheatInfo).toHaveBeenCalledTimes(1)
  })

  test('settings are cached under their own key', async () => {
    const t = setup()
    await t.gameDetailsApi.requestGameSettings('game-a')
    await t.gameDetailsApi.requestGameSettings('game-a')
    expect(t.ipc.requestGameSettings).toHaveBeenCalledTimes(1)
    expect(t.store.getSlot('settings:game-a', 'settings')?.data).toEqual({
      wineVersion: 'w'
    })
  })
})

test('concurrent requests for a missing slot share one IPC call', async () => {
  const t = setup()
  const [a, b] = await Promise.all([
    t.gameDetailsApi.getWikiGameInfo('Test Game', 'game-a', runner),
    t.gameDetailsApi.getWikiGameInfo('Test Game', 'game-a', runner)
  ])
  expect(a).toBe(b)
  expect(t.ipc.getWikiGameInfo).toHaveBeenCalledTimes(1)
})

test('extra info is cached per UI language', async () => {
  const t = setup()
  await t.gameDetailsApi.getExtraInfo('game-a', runner)
  t.state.language = 'de'
  await t.gameDetailsApi.getExtraInfo('game-a', runner)
  t.state.language = 'en'
  await t.gameDetailsApi.getExtraInfo('game-a', runner)
  expect(t.ipc.getExtraInfo).toHaveBeenCalledTimes(2)
  expect(Object.keys(t.store.getEntry('legendary:game-a')!.slots)).toEqual([
    'extraInfo@en',
    'extraInfo@de'
  ])
})

test('install info is cached per install platform; the helper maps it per runner', async () => {
  const t = setup()
  await t.gameDetailsApi.getInstallInfo('game-a', runner, 'Windows')
  await t.gameDetailsApi.getInstallInfo('game-a', runner, 'Mac')
  await t.gameDetailsApi.getInstallInfo('game-a', runner, 'Windows')
  expect(t.installInfo).toHaveBeenCalledTimes(2)
  // other builds/branches are not cached
  await t.gameDetailsApi.getInstallInfo('game-a', runner, 'Windows', 'build-1')
  expect(t.installInfo).toHaveBeenCalledTimes(3)

  const ipc = jest.fn(() => Promise.resolve(null))
  Object.assign(window.api, { getInstallInfo: ipc })
  await getInstallInfo('1', 'gog', 'Windows')
  expect(ipc).toHaveBeenCalledWith('1', 'gog', 'windows', undefined, undefined)
})

describe('failures', () => {
  test('a failed fetch rejects only when nothing is cached (or when forced)', async () => {
    const t = setup()
    t.ipc.getExtraInfo.mockRejectedValueOnce(new Error('offline'))
    await expect(
      t.gameDetailsApi.getExtraInfo('game-a', runner)
    ).rejects.toThrow()
    const good = await t.gameDetailsApi.getExtraInfo('game-a', runner)
    t.ipc.getExtraInfo.mockRejectedValueOnce(new Error('offline'))
    expect(await t.gameDetailsApi.getExtraInfo('game-a', runner)).toBe(good) // cached
    // a forced fetch reports it; the cached data stays
    await expect(
      t.gameDetailsApi.getExtraInfo('game-a', runner, { force: true })
    ).rejects.toThrow()
    expect(t.store.getSlot('legendary:game-a', 'extraInfo@en')?.data).toBe(good)
  })

  test('failure-shaped extra info is shown but never stored or replacing good data', async () => {
    const t = setup()
    t.ipc.getExtraInfo.mockResolvedValueOnce(failedExtra)
    expect(await t.gameDetailsApi.getExtraInfo('game-a', runner)).toBe(
      failedExtra
    )
    expect(t.store.getSlot('legendary:game-a', 'extraInfo@en')).toBeUndefined()
    const good = await t.gameDetailsApi.getExtraInfo('game-a', runner)
    t.ipc.getExtraInfo.mockResolvedValueOnce(failedExtra)
    await expect(
      t.gameDetailsApi.getExtraInfo('game-a', runner, { force: true })
    ).rejects.toBeInstanceOf(FailureShapedResult)
    expect(t.store.getSlot('legendary:game-a', 'extraInfo@en')?.data).toBe(good)
  })

  test('a missing install info (null) is not stored', async () => {
    const t = setup()
    t.installInfo.mockResolvedValueOnce(null as never)
    expect(
      await t.gameDetailsApi.getInstallInfo('game-a', runner, 'Windows')
    ).toBeNull()
    expect(t.store.getEntry('legendary:game-a')?.slots).toBeUndefined()
  })

  test('an empty achievement list never replaces a non-empty one', async () => {
    const t = setup()
    const list = [{ name: 'a' }]
    t.ipc.getAchievements.mockResolvedValueOnce(list as never)
    await t.gameDetailsApi.getAchievements('1', 'gog')
    t.ipc.getAchievements.mockResolvedValueOnce([])
    await expect(
      t.gameDetailsApi.getAchievements('1', 'gog', undefined, { force: true })
    ).rejects.toBeInstanceOf(FailureShapedResult)
    expect(t.store.getSlot('gog:1', 'achievements')?.data).toBe(list)
  })
})

describe('wiki', () => {
  test('all-empty results stay missing; the third one stores "no wiki data"', async () => {
    const t = setup()
    t.ipc.getWikiGameInfo.mockResolvedValue(emptyWiki as never)
    for (let i = 1; i < WIKI_EMPTY_LIMIT; i++) {
      await t.gameDetailsApi.getWikiGameInfo('Test Game', 'game-a', runner)
      expect(t.store.getSlot('legendary:game-a', 'wikiInfo')).toBeUndefined()
    }
    await t.gameDetailsApi.getWikiGameInfo('Test Game', 'game-a', runner)
    expect(t.store.getSlot('legendary:game-a', 'wikiInfo')).toEqual({
      data: null
    })
    await t.gameDetailsApi.getWikiGameInfo('Test Game', 'game-a', runner)
    expect(t.ipc.getWikiGameInfo).toHaveBeenCalledTimes(WIKI_EMPTY_LIMIT)
  })

  test('GamePage + GameSubMenu asking together count one empty result', async () => {
    const t = setup()
    t.ipc.getWikiGameInfo.mockResolvedValue(emptyWiki as never)
    await Promise.all([
      t.gameDetailsApi.getWikiGameInfo('Test Game', 'game-a', runner),
      t.gameDetailsApi.getWikiGameInfo('Test Game', 'game-a', runner)
    ])
    expect(t.store.getEntry('legendary:game-a')?.wikiEmpty).toBe(1)
  })

  test('offline empty results do not count', async () => {
    const t = setup({ online: false })
    t.ipc.getWikiGameInfo.mockResolvedValue(emptyWiki as never)
    await t.gameDetailsApi.getWikiGameInfo('Test Game', 'game-a', runner)
    expect(t.store.getEntry('legendary:game-a')?.wikiEmpty).toBeUndefined()
  })

  test('a forced fetch drops the "no wiki data" marker and never empties real data', async () => {
    const t = setup()
    t.store.setSlot('legendary:game-a', 'wikiInfo', null)
    await t.gameDetailsApi.getWikiGameInfo('Test Game', 'game-a', runner, {
      force: true
    })
    expect(t.store.getSlot('legendary:game-a', 'wikiInfo')?.data).toEqual(wiki)
    t.ipc.getWikiGameInfo.mockResolvedValueOnce(emptyWiki as never)
    await expect(
      t.gameDetailsApi.getWikiGameInfo('Test Game', 'game-a', runner, {
        force: true
      })
    ).rejects.toBeInstanceOf(FailureShapedResult)
    expect(t.store.getSlot('legendary:game-a', 'wikiInfo')?.data).toEqual(wiki)
  })
})

describe('refresh epochs and holds', () => {
  test('a fetch started before a Refresh is not stored; the forced one is', async () => {
    const t = setup()
    const old = deferred<typeof goodExtra>()
    t.ipc.getExtraInfo.mockReturnValueOnce(old.promise)
    const before = t.gameDetailsApi.getExtraInfo('game-a', runner)
    await Promise.resolve()
    t.gameDetailsApi.beginRefresh(runner, 'game-a')
    const fresh = { ...goodExtra, storeUrl: 'https://store.example/new' }
    t.ipc.getExtraInfo.mockResolvedValueOnce(fresh)
    await t.gameDetailsApi.getExtraInfo('game-a', runner, { force: true })
    old.resolve(goodExtra)
    await before
    expect(t.store.getSlot('legendary:game-a', 'extraInfo@en')?.data).toBe(
      fresh
    )
  })

  test('the settings key belongs to the game Refresh epoch', async () => {
    const t = setup()
    const old = deferred<{ wineVersion: string }>()
    t.ipc.requestGameSettings.mockReturnValueOnce(old.promise)
    const before = t.gameDetailsApi.requestGameSettings('game-a')
    t.gameDetailsApi.beginRefresh(runner, 'game-a')
    old.resolve({ wineVersion: 'old' })
    await before
    expect(t.store.getSlot('settings:game-a', 'settings')).toBeUndefined()
  })

  test('a forced wiki fetch never joins one from an older epoch', async () => {
    const t = setup()
    const old = deferred<typeof wiki>()
    t.ipc.getWikiGameInfo.mockReturnValueOnce(old.promise)
    const first = t.gameDetailsApi.getWikiGameInfo(
      'Test Game',
      'game-a',
      runner,
      {
        force: true
      }
    )
    await Promise.resolve()
    t.gameDetailsApi.beginRefresh(runner, 'game-a')
    const second = t.gameDetailsApi.getWikiGameInfo(
      'Test Game',
      'game-a',
      runner,
      {
        force: true
      }
    )
    await Promise.resolve()
    expect(t.ipc.getWikiGameInfo).toHaveBeenCalledTimes(2)
    old.resolve(wiki)
    await Promise.all([first, second])
  })

  test('fetches of a held game wait until the backend dropped its caches', async () => {
    const t = setup()
    const dropped = deferred<void>()
    t.gameDetailsApi.holdFetches(runner, 'game-a', dropped.promise)
    const pending = t.gameDetailsApi.getExtraInfo('game-a', runner)
    const settings = t.gameDetailsApi.requestGameSettings('game-a')
    await Promise.resolve()
    expect(t.ipc.getExtraInfo).not.toHaveBeenCalled()
    expect(t.ipc.requestGameSettings).not.toHaveBeenCalled()
    await t.gameDetailsApi.getExtraInfo('other', runner) // other games are not held
    dropped.resolve()
    await Promise.all([pending, settings])
    expect(t.ipc.getExtraInfo).toHaveBeenCalledTimes(2)
  })
})

describe('list signatures', () => {
  test('a filled slot records the list data it was fetched with', async () => {
    const t = setup()
    await t.gameDetailsApi.getExtraInfo('game-a', runner)
    expect(t.store.getEntry('legendary:game-a')?.listSig).toEqual({
      meta: listSigOf(libraryGame).meta
    })
    await t.gameDetailsApi.getInstallInfo('game-a', runner, 'Windows')
    expect(t.store.getEntry('legendary:game-a')?.listSig?.install).toBe(
      listSigOf(libraryGame).install
    )
  })

  test('the signature is taken when the fetch starts', async () => {
    const t = setup()
    const pending = deferred<typeof goodExtra>()
    t.ipc.getExtraInfo.mockReturnValueOnce(pending.promise)
    const fetching = t.gameDetailsApi.getExtraInfo('game-a', runner)
    await Promise.resolve()
    t.setLibraryGame({ ...libraryGame, title: 'Renamed' } as GameInfo)
    pending.resolve(goodExtra)
    await fetching
    expect(t.store.getEntry('legendary:game-a')?.listSig?.meta).toBe(
      listSigOf(libraryGame).meta
    )
  })

  test('a partial forced fetch preserves conservative group provenance', async () => {
    const t = setup()
    await t.gameDetailsApi.getExtraInfo('game-a', runner)
    const renamed = { ...libraryGame, title: 'Renamed' } as GameInfo
    t.setLibraryGame(renamed)
    await t.gameDetailsApi.getWikiGameInfo('Renamed', 'game-a', runner)
    expect(t.store.getEntry('legendary:game-a')?.listSig?.meta).toBe(
      listSigOf(libraryGame).meta
    )
    await t.gameDetailsApi.getExtraInfo('game-a', runner, { force: true })
    expect(t.store.getEntry('legendary:game-a')?.listSig?.meta).toBe(
      listSigOf(libraryGame).meta
    )
  })

  test('local-only slots and opted-out fetches record nothing', async () => {
    const t = setup()
    await t.gameDetailsApi.getKnownFixes('game-a', runner)
    await t.gameDetailsApi.getLaunchOptions('game-a', runner, {
      recordListSig: false
    })
    expect(t.store.getEntry('legendary:game-a')?.listSig).toBeUndefined()
  })
})

test('clearing the cache prevents pending requests from repopulating it', async () => {
  const t = setup()
  const pending = deferred<typeof goodExtra>()
  t.ipc.getExtraInfo.mockReturnValueOnce(pending.promise)
  const fetching = t.gameDetailsApi.getExtraInfo('game-a', runner)
  await Promise.resolve()
  await t.store.clearAll()
  pending.resolve(goodExtra)
  await fetching
  expect(t.store.keys()).toEqual([])
})

test('a settings edit prevents an older settings response from overwriting the edit', async () => {
  const t = setup()
  const pending = deferred<{ wineVersion: string }>()
  t.ipc.requestGameSettings.mockReturnValueOnce(pending.promise)
  const fetching = t.gameDetailsApi.requestGameSettings('game-a')
  await Promise.resolve()
  t.gameDetailsApi.invalidateSettings('game-a')
  t.store.setSlot('settings:game-a', 'settings', { wineVersion: 'edited' })
  pending.resolve({ wineVersion: 'old' })
  await fetching
  expect(t.store.getSlot('settings:game-a', 'settings')?.data).toEqual({
    wineVersion: 'edited'
  })
})

test('successful negative fixes and empty options replace obsolete slots while rejected requests retain good values', async () => {
  const t = setup()
  t.store.setSlot('legendary:game-a', 'knownFixes', { title: 'obsolete' })
  t.store.setSlot('legendary:game-a', 'launchOptions', [{ name: 'obsolete' }])
  expect(
    await t.gameDetailsApi.getKnownFixes('game-a', runner, { force: true })
  ).toBeNull()
  expect(
    await t.gameDetailsApi.getLaunchOptions('game-a', runner, { force: true })
  ).toEqual([])
  expect(t.store.getSlot('legendary:game-a', 'knownFixes')?.data).toBeNull()
  expect(t.store.getSlot('legendary:game-a', 'launchOptions')?.data).toEqual([])
  t.store.setSlot('legendary:game-a', 'knownFixes', { title: 'good' })
  t.ipc.getKnownFixes.mockRejectedValueOnce(Error('lookup failed'))
  await expect(
    t.gameDetailsApi.getKnownFixes('game-a', runner, { force: true })
  ).rejects.toThrow('lookup failed')
  expect(t.store.getSlot('legendary:game-a', 'knownFixes')?.data).toEqual({
    title: 'good'
  })
})

test('removing a game during its request prevents an old response from restoring its entry', async () => {
  const t = setup()
  const delayed = deferred<typeof goodExtra>()
  t.ipc.getExtraInfo.mockReturnValueOnce(delayed.promise)
  const request = t.gameDetailsApi.getExtraInfo('game-a', runner)
  await Promise.resolve()
  t.store.removeKeys(['legendary:game-a'])
  delayed.resolve(goodExtra)
  await request
  expect(t.store.getEntry('legendary:game-a')).toBeUndefined()
})

test('a missing/malformed fixes file preserves good fixes while undefined means successfully removed', async () => {
  const t = setup()
  const good = { title: 'Synthetic fix' }
  t.store.setSlot('legendary:game-a', 'knownFixes', good)
  t.ipc.getKnownFixes.mockResolvedValueOnce(null as never)
  await expect(
    t.gameDetailsApi.getKnownFixes('game-a', runner, { force: true })
  ).rejects.toBeInstanceOf(FailureShapedResult)
  expect(t.store.getSlot('legendary:game-a', 'knownFixes')?.data).toBe(good)
  await t.gameDetailsApi.getKnownFixes('game-a', runner, { force: true })
  expect(t.store.getSlot('legendary:game-a', 'knownFixes')?.data).toBeNull()
})

test('successful anti-cheat absence replaces an earlier entry while supported-platform file failure never fills a cold slot', async () => {
  const t = setup()
  t.store.setSlot('legendary:game-a', 'anticheat', { name: 'old' })
  await t.gameDetailsApi.getAnticheatInfo('ns', 'legendary', 'game-a', {
    force: true
  })
  expect(t.store.getSlot('legendary:game-a', 'anticheat')?.data).toBeNull()
  t.ipc.getAnticheatInfo.mockResolvedValueOnce(null as never)
  expect(
    await t.gameDetailsApi.getAnticheatInfo('ns', 'legendary', 'game-b')
  ).toBeNull()
  expect(t.store.getSlot('legendary:game-b', 'anticheat')).toBeUndefined()
})

test('explicit Windows anti-cheat unsupported result fills a none marker', async () => {
  const t = setup({ platform: 'win32' })
  t.ipc.getAnticheatInfo.mockResolvedValueOnce(null as never)
  await t.gameDetailsApi.getAnticheatInfo('ns', 'legendary', 'game-a')
  expect(t.store.getSlot('legendary:game-a', 'anticheat')?.data).toBeNull()
})

test('forced anti-cheat file failure preserves a previously successful entry', async () => {
  const t = setup()
  const anticheatInfo = { name: 'known' }
  t.store.setSlot('legendary:game-a', 'anticheat', anticheatInfo)
  t.ipc.getAnticheatInfo.mockResolvedValueOnce(null as never)
  await expect(
    t.gameDetailsApi.getAnticheatInfo('ns', 'legendary', 'game-a', {
      force: true
    })
  ).rejects.toBeInstanceOf(FailureShapedResult)
  expect(t.store.getSlot('legendary:game-a', 'anticheat')?.data).toBe(
    anticheatInfo
  )
})
