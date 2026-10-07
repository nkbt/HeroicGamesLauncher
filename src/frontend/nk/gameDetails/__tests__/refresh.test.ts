import type { GameInfo } from 'common/types'
import { createGameDetailsApi, type DetailsIpc } from '../api'
import { listSigOf } from '../logic'
import { MemoryPersistence } from '../persistence'
import { refreshGameDetails, refreshState } from '../refresh'
import { createGameDetailsStore } from '../store'

const extra = {
  about: { description: 'A test game.', shortDescription: '' },
  reqs: [],
  storeUrl: 'https://store.example/test-game'
}
const wiki = {
  pcgamingwiki: null,
  applegamingwiki: null,
  howlongtobeat: { mainStory: 1, mainExtra: 2, completionist: 3 },
  gamesdb: null,
  steamInfo: null,
  umuId: null
}

const game = {
  app_name: 'game-a',
  runner: 'legendary',
  title: 'Test Game',
  namespace: 'ns-1',
  is_installed: true,
  install: { platform: 'Windows' },
  art_cover: 'https://img.example/a.jpg'
} as unknown as GameInfo

function setup() {
  const store = createGameDetailsStore(new MemoryPersistence(), {
    scheduleNotify: () => undefined,
    warn: jest.fn()
  })
  const ipc = {
    getExtraInfo: jest.fn(() => Promise.resolve(extra)),
    getWikiGameInfo: jest.fn(() => Promise.resolve(wiki)),
    getAchievements: jest.fn(() => Promise.resolve([])),
    getAchievementsForAccount: jest.fn(() => Promise.resolve([])),
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
  const gameDetailsApi = createGameDetailsApi(store, {
    getAccountId: () => 'synthetic-account',
    ipc: () => ipc as unknown as DetailsIpc,
    getInstallInfo: installInfo as never,
    platform: 'linux',
    getLanguage: () => 'en',
    isOnline: () => true,
    getLibraryGame: () => game
  })
  const invalidateGameDetailsCaches = jest.fn(() =>
    Promise.resolve({
      dropped: ['legendary_install_info'],
      failed: [] as string[],
      art: { refreshed: 3, failed: 0 }
    })
  )
  const deps = {
    gameDetailsApi,
    store,
    invalidateGameDetailsCaches,
    refreshStatus: jest.fn(() => Promise.resolve(undefined)),
    platform: 'linux',
    language: 'en',
    online: true,
    warn: jest.fn()
  }
  return {
    gameDetailsApi,
    store,
    ipc,
    installInfo,
    invalidateGameDetailsCaches,
    deps
  }
}

test('drops the backend caches first, then re-fetches every slot once', async () => {
  const t = setup()
  // a cached second platform is refreshed too
  t.store.setSlot('legendary:game-a', 'installInfo@Mac', { old: true })
  let fetchedBeforeDrop = false
  t.invalidateGameDetailsCaches.mockImplementationOnce(() => {
    fetchedBeforeDrop = t.ipc.getExtraInfo.mock.calls.length > 0
    return Promise.resolve({
      dropped: [],
      failed: [],
      art: { refreshed: 3, failed: 0 }
    })
  })

  const progress = await refreshGameDetails(game, t.deps)

  expect(fetchedBeforeDrop).toBe(false)
  expect(t.invalidateGameDetailsCaches).toHaveBeenCalledWith({
    appName: 'game-a',
    runner: 'legendary',
    scope: 'all',
    artUrls: expect.arrayContaining([
      'https://img.example/a.jpg?h=800&resize=1&w=600'
    ]) as unknown
  })
  expect(t.ipc.getExtraInfo).toHaveBeenCalledTimes(1)
  expect(t.ipc.getWikiGameInfo).toHaveBeenCalledTimes(1)
  expect(t.ipc.getAchievements).toHaveBeenCalledTimes(1)
  expect(t.ipc.requestGameSettings).toHaveBeenCalledTimes(1)
  expect(t.ipc.getAnticheatInfo).toHaveBeenCalledTimes(1)
  expect(t.ipc.getKnownFixes).toHaveBeenCalledTimes(1)
  expect(t.ipc.getLaunchOptions).toHaveBeenCalledTimes(1)
  expect(t.deps.refreshStatus).toHaveBeenCalledWith(game, expect.any(Function))
  expect(
    (t.installInfo.mock.calls as unknown as Array<[string, string, string]>)
      .map((call) => call[2])
      .sort()
  ).toEqual(['Mac', 'Windows'])
  expect(progress).toEqual({ done: 11, total: 11, failed: 0 })
  expect(t.store.getEntry('legendary:game-a')?.listSig).toEqual(listSigOf(game))
})

test('a backend that could not drop a cache: nothing is fetched, failure reported', async () => {
  const t = setup()
  t.store.setSlot('legendary:game-a', 'wikiInfo', wiki)
  t.invalidateGameDetailsCaches.mockResolvedValueOnce({
    dropped: [],
    failed: ['wikigameinfo'],
    art: { refreshed: 0, failed: 0 }
  })
  const progress = await refreshGameDetails(game, t.deps)
  expect(t.ipc.getWikiGameInfo).not.toHaveBeenCalled()
  expect(progress.failed).toBe(progress.total)
  expect(refreshState.getState().failed['legendary:game-a']).toBe(
    progress.total
  )
  expect(t.store.getSlot('legendary:game-a', 'wikiInfo')?.data).toBe(wiki)
})

test('failed fetches keep the old values and are reported', async () => {
  const t = setup()
  const old = { ...extra, storeUrl: 'https://store.example/old' }
  t.store.setSlot('legendary:game-a', 'extraInfo@en', old)
  t.ipc.getExtraInfo.mockRejectedValueOnce(new Error('offline'))
  const progress = await refreshGameDetails(game, t.deps)
  expect(progress.failed).toBe(1)
  expect(t.store.getSlot('legendary:game-a', 'extraInfo@en')?.data).toBe(old)
})

test('equal data keeps the stored objects; other games are not touched', async () => {
  const t = setup()
  const cached = { ...extra }
  t.store.setSlot('legendary:game-a', 'extraInfo@en', cached)
  t.store.setSlot('legendary:game-b', 'extraInfo@en', { other: true })
  const other = t.store.getEntry('legendary:game-b')
  await refreshGameDetails(game, t.deps)
  expect(t.store.getSlot('legendary:game-a', 'extraInfo@en')?.data).toBe(cached)
  expect(t.store.getEntry('legendary:game-b')).toBe(other)
})

test('extra info of other languages is dropped', async () => {
  const t = setup()
  t.store.setSlot('legendary:game-a', 'extraInfo@de', extra)
  await refreshGameDetails(game, t.deps)
  expect(
    Object.keys(t.store.getEntry('legendary:game-a')!.slots)
  ).not.toContain('extraInfo@de')
})

test('a second click while running joins the first; progress is published', async () => {
  const t = setup()
  const first = refreshGameDetails(game, t.deps)
  const second = refreshGameDetails(game, t.deps)
  expect(second).toBe(first)
  expect(refreshState.getState().running['legendary:game-a']?.total).toBe(10)
  await first
  expect(refreshState.getState().running['legendary:game-a']).toBeUndefined()
  expect(t.invalidateGameDetailsCaches).toHaveBeenCalledTimes(1)
})

test('sideloaded and browser games refresh only their local data', async () => {
  const t = setup()
  await refreshGameDetails(
    {
      ...game,
      runner: 'sideload',
      browserUrl: 'https://a.example'
    } as GameInfo,
    t.deps
  )
  expect(t.ipc.getExtraInfo).not.toHaveBeenCalled()
  expect(t.ipc.getWikiGameInfo).not.toHaveBeenCalled()
  expect(t.installInfo).not.toHaveBeenCalled()
  expect(t.ipc.requestGameSettings).toHaveBeenCalledTimes(1)
})

test('clear during refresh backend invalidation prevents refill and signature writes', async () => {
  const t = setup()
  let release!: (value: {
    dropped: never[]
    failed: never[]
    art: { refreshed: number; failed: number }
  }) => void
  const delayed = new Promise<{
    dropped: never[]
    failed: never[]
    art: { refreshed: number; failed: number }
  }>((resolve) => {
    release = resolve
  })
  t.invalidateGameDetailsCaches.mockReturnValueOnce(delayed)
  const refresh = refreshGameDetails(game, t.deps)
  await t.store.clearAll()
  release({ dropped: [], failed: [], art: { refreshed: 0, failed: 0 } })
  await refresh
  expect(t.ipc.getExtraInfo).not.toHaveBeenCalled()
  expect(t.store.keys()).toEqual([])
})
