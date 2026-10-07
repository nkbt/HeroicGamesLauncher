import type {
  ExtraInfo,
  GameInfo,
  GameSettings,
  InstallInfo,
  WikiInfo
} from 'common/types'
import type { InvalidateGameDetailsRequest } from 'common/types/nk/gameDetails'
import { createImageCache } from 'backend/nk/imageCache/core'
import { createHookRoot } from 'frontend/nk/test/hookRuntime'
import { isImageLoaded } from 'frontend/nk/loadedImages'
import { createGameDetailsApi, type DetailsIpc } from '../api'
import { useDetailsArt } from '../hooks'
import { gameDetailsScheduler, gameDetailsStore } from '../instance'
import { gamePageArtUrls } from '../imageUrls'
import { refreshGameDetails } from '../refresh'
import { tick } from './phase2Fixtures'

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('frontend/nk/test/hookRuntime')>(
    'frontend/nk/test/hookRuntime'
  ).react,
  useDebugValue: () => undefined
}))
jest.mock('frontend/hooks/constants', () => ({ getStatusLabel: () => '' }))
jest.mock('i18next', () => ({ __esModule: true, default: { language: 'en' } }))
jest.mock('../instance', () => {
  const { createGameDetailsStore } =
    jest.requireActual<typeof import('../store')>('../store')
  const { MemoryPersistence } =
    jest.requireActual<typeof import('../persistence')>('../persistence')
  const { createDetailsScheduler } =
    jest.requireActual<typeof import('../scheduler')>('../scheduler')
  return {
    gameDetailsStore: createGameDetailsStore(new MemoryPersistence(), {
      scheduleNotify: () => undefined
    }),
    gameDetailsScheduler: createDetailsScheduler(),
    getLibraryGame: () => undefined
  }
})

const OriginalImage = global.Image

beforeEach(async () => {
  await gameDetailsStore.clearAll()
  gameDetailsScheduler.update({
    online: true,
    downloading: false,
    playing: false,
    launching: false,
    refreshing: false,
    enabled: true
  })
})

afterEach(() => {
  global.Image = OriginalImage
  expect(gameDetailsScheduler.pending()).toBe(0)
})

function setup(appName: string) {
  const gameInfo = {
    runner: 'legendary',
    app_name: appName,
    title: 'Synthetic Artwork',
    namespace: 'synthetic',
    is_installed: false,
    install: {},
    art_background: `https://images.example/${appName}/background`,
    art_cover: `https://images.example/${appName}/cover`,
    art_logo: `https://images.example/${appName}/logo`
  } as GameInfo
  gameDetailsStore.patchEntry(`legendary:${appName}`, (entry) => ({
    ...entry,
    gameInfo
  }))
  gameDetailsStore.notify()
  const request = jest.fn((url: string) =>
    Promise.resolve({
      status: 200,
      contentType: 'image/png',
      body: url,
      discard: () => undefined
    })
  )
  const imageCache = createImageCache({
    dir: '/synthetic-image-cache',
    readdir: () => [],
    request,
    writeBody: () => Promise.resolve(),
    rename: () => Promise.resolve(),
    unlink: () => Promise.resolve(),
    // Intentionally keep the transport usable: the caller must enforce pauses.
    isOnline: () => true,
    runOnceWhenOnline: () => undefined,
    logInfo: () => undefined,
    logWarning: () => undefined
  })
  imageCache.init()
  const protocolSources: string[] = []
  global.Image = jest.fn(() => {
    const image = {
      src: '',
      decode: () => {
        protocolSources.push(image.src)
        return imageCache
          .ensure(decodeURIComponent(image.src.slice('imagecache://'.length)))
          .then(() => undefined)
      }
    }
    return image
  }) as unknown as typeof Image
  const ipc: DetailsIpc = {
    getExtraInfo: jest.fn(() =>
      Promise.resolve({
        about: { description: 'Synthetic description' },
        storeUrl: 'https://store.example/synthetic'
      } as ExtraInfo)
    ),
    getWikiGameInfo: jest.fn(() =>
      Promise.resolve({ pcgamingwiki: { steamID: '123' } } as WikiInfo)
    ),
    getAchievements: jest.fn(() => Promise.resolve([])),
    requestGameSettings: jest.fn(() =>
      Promise.resolve({ wineVersion: 'synthetic' } as unknown as GameSettings)
    ),
    getAnticheatInfo: jest.fn(() => Promise.resolve(undefined)),
    getKnownFixes: jest.fn(() => Promise.resolve(undefined)),
    getLaunchOptions: jest.fn(() => Promise.resolve([])),
    clearAchievementCache: jest.fn()
  }
  const gameDetailsApi = createGameDetailsApi(gameDetailsStore, {
    ipc: () => ipc,
    scheduler: gameDetailsScheduler,
    getInstallInfo: () =>
      Promise.resolve({
        manifest: { disk_size: 5, download_size: 3 }
      } as InstallInfo),
    platform: 'linux',
    getLanguage: () => 'en',
    isOnline: () => true,
    getLibraryGame: () => gameInfo
  })
  const invalidateGameDetailsCaches = jest.fn(
    (request: InvalidateGameDetailsRequest) =>
      imageCache.refreshImages(request.artUrls).then((art) => ({
        dropped: [],
        failed: [],
        art
      }))
  )
  const deps = {
    store: gameDetailsStore,
    gameDetailsApi,
    invalidateGameDetailsCaches,
    refreshStatus: () => Promise.resolve(),
    platform: 'linux',
    language: 'en',
    // A Refresh intent may already exist before connectivity/download changes.
    online: true,
    warn: jest.fn()
  }
  return {
    gameInfo,
    gameDetailsApi,
    ipc,
    request,
    protocolSources,
    invalidateGameDetailsCaches,
    deps
  }
}

test('cold page artwork waits offline while local detail reads continue, then warms exact URLs once', async () => {
  const t = setup('art-offline')
  gameDetailsScheduler.update({ online: false })
  const view = createHookRoot(() => useDetailsArt('legendary', 'art-offline'))
  view.render({})
  await t.gameDetailsApi.requestGameSettings('art-offline')
  await t.gameDetailsApi.getKnownFixes('art-offline', 'legendary')
  expect(t.ipc.requestGameSettings).toHaveBeenCalledTimes(1)
  expect(t.ipc.getKnownFixes).toHaveBeenCalledTimes(1)
  expect(t.protocolSources).toEqual([])
  expect(t.request).not.toHaveBeenCalled()
  gameDetailsScheduler.update({ online: true })
  await view.settle()
  await tick()
  const urls = [
    'https://images.example/art-offline/background',
    'https://images.example/art-offline/cover?h=800&resize=1&w=600',
    'https://images.example/art-offline/logo?h=400&resize=1&w=300'
  ]
  expect(t.protocolSources).toEqual(
    urls.map((url) => `imagecache://${encodeURIComponent(url)}`)
  )
  expect(t.request.mock.calls.map(([url]) => url)).toEqual(urls)
  expect(t.request).toHaveBeenCalledTimes(3)
  expect(isImageLoaded(urls[1])).toBe(true)
  view.unmount()
  const cached = createHookRoot(() => useDetailsArt('legendary', 'art-offline'))
  cached.render({})
  await cached.settle()
  await tick()
  expect(t.request).toHaveBeenCalledTimes(3)
  expect(t.protocolSources).toHaveLength(3)
  cached.unmount()
})

test('cold page artwork waits during downloads and resumes once without blocking cached or local details', async () => {
  const t = setup('art-downloading')
  const settings = { wineVersion: 'cached' } as unknown as GameSettings
  gameDetailsStore.setSlot('settings:art-downloading', 'settings', settings)
  gameDetailsScheduler.update({ downloading: true })
  const view = createHookRoot(() =>
    useDetailsArt('legendary', 'art-downloading')
  )
  view.render({})
  expect(await t.gameDetailsApi.requestGameSettings('art-downloading')).toBe(
    settings
  )
  expect(t.ipc.requestGameSettings).not.toHaveBeenCalled()
  await t.gameDetailsApi.getKnownFixes('art-downloading', 'legendary')
  expect(t.ipc.getKnownFixes).toHaveBeenCalledTimes(1)
  expect(t.request).not.toHaveBeenCalled()
  expect(t.protocolSources).toEqual([])
  gameDetailsScheduler.update({ downloading: false })
  await view.settle()
  await tick()
  expect(t.request.mock.calls.map(([url]) => url)).toEqual(
    gamePageArtUrls(t.gameInfo)
  )
  expect(t.request).toHaveBeenCalledTimes(3)
  view.unmount()
})

test('target Refresh waits offline before forced image transport, joins repeated intent and allows local work', async () => {
  const t = setup('refresh-art-offline')
  gameDetailsScheduler.update({ online: false })
  const first = refreshGameDetails(t.gameInfo, t.deps)
  const joined = refreshGameDetails(t.gameInfo, t.deps)
  expect(joined).toBe(first)
  await t.gameDetailsApi.requestGameSettings('other-offline')
  await t.gameDetailsApi.getKnownFixes('other-offline', 'legendary')
  expect(t.invalidateGameDetailsCaches).not.toHaveBeenCalled()
  expect(t.request).not.toHaveBeenCalled()
  gameDetailsScheduler.update({ online: true })
  const progress = await first
  await tick()
  expect(progress.failed).toBe(0)
  expect(t.invalidateGameDetailsCaches).toHaveBeenCalledTimes(1)
  const artUrls = t.invalidateGameDetailsCaches.mock.calls[0][0].artUrls!
  expect(artUrls).toEqual(expect.arrayContaining(gamePageArtUrls(t.gameInfo)))
  expect(t.request.mock.calls.map(([url]) => url)).toEqual([
    ...new Set(artUrls)
  ])
})

test('target Refresh waits during downloads before forced image transport, then dispatches once', async () => {
  const t = setup('refresh-art-downloading')
  gameDetailsScheduler.update({ downloading: true })
  const first = refreshGameDetails(t.gameInfo, t.deps)
  const joined = refreshGameDetails(t.gameInfo, t.deps)
  expect(joined).toBe(first)
  await t.gameDetailsApi.requestGameSettings('other-downloading')
  await t.gameDetailsApi.getKnownFixes('other-downloading', 'legendary')
  expect(t.invalidateGameDetailsCaches).not.toHaveBeenCalled()
  expect(t.request).not.toHaveBeenCalled()
  gameDetailsScheduler.update({ downloading: false })
  expect((await first).failed).toBe(0)
  await tick()
  expect(t.invalidateGameDetailsCaches).toHaveBeenCalledTimes(1)
  const artUrls = t.invalidateGameDetailsCaches.mock.calls[0][0].artUrls!
  expect(t.request.mock.calls.map(([url]) => url)).toEqual([
    ...new Set(artUrls)
  ])
})

test('Refresh without artwork transport keeps its invalidation local while downloads are active', async () => {
  const t = setup('refresh-local-only')
  gameDetailsScheduler.update({ downloading: true })
  const pending = refreshGameDetails(t.gameInfo, { ...t.deps, online: false })
  await tick()
  await tick()
  expect(t.invalidateGameDetailsCaches).toHaveBeenCalledTimes(1)
  expect(t.invalidateGameDetailsCaches.mock.calls[0][0].artUrls).toBeUndefined()
  expect(t.request).not.toHaveBeenCalled()
  gameDetailsScheduler.update({ downloading: false })
  await pending
  await tick()
  expect(t.request).not.toHaveBeenCalled()
})
