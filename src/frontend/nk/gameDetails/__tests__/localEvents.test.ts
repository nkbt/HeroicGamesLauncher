import { createGameDetailsApi, type DetailsIpc } from '../api'
import { createLocalEvents } from '../localEvents'
import { MemoryPersistence } from '../persistence'
import { createGameDetailsStore } from '../store'

function setup(
  online = true,
  persistence = new MemoryPersistence(),
  seed = true
) {
  const connectivity = { online }
  const store = createGameDetailsStore(persistence, {
    scheduleNotify: () => undefined
  })
  const ipc = {
    getLaunchOptions: jest.fn(() => Promise.resolve([{ name: 'updated' }])),
    requestGameSettings: jest.fn(() =>
      Promise.resolve({ wineVersion: 'updated' })
    ),
    getAchievements: jest.fn(() => Promise.resolve([{ name: 'new' }])),
    clearAchievementCache: jest.fn()
  }
  const getInstallInfo = jest.fn(() =>
    Promise.resolve({
      manifest: { disk_size: 2, download_size: 1 }
    })
  )
  const gameDetailsApi = createGameDetailsApi(store, {
    ipc: () => ipc as unknown as DetailsIpc,
    getInstallInfo: getInstallInfo as never,
    platform: 'linux',
    getLanguage: () => 'en',
    isOnline: () => connectivity.online,
    getLibraryGame: () => undefined
  })
  const invalidateGameDetailsCaches = jest.fn(() =>
    Promise.resolve({
      dropped: [],
      failed: [] as string[],
      art: { refreshed: 0, failed: 0 }
    })
  )
  const events = createLocalEvents({
    gameDetailsApi,
    store,
    invalidateGameDetailsCaches,
    isOnline: () => connectivity.online,
    warn: jest.fn()
  })
  void store.hydrate()
  if (seed) {
    store.setSlot('gog:1', 'installInfo@Windows', {
      manifest: { disk_size: 1 }
    })
    store.setSlot('gog:1', 'launchOptions', [{ name: 'old' }])
    store.setSlot('settings:1', 'settings', { wineVersion: 'old' })
    store.setSlot('gog:1', 'achievements', [{ name: 'old' }])
    store.setSlot('gog:2', 'installInfo@Windows', { untouched: true })
  }
  return {
    store,
    gameDetailsApi,
    ipc,
    getInstallInfo,
    invalidateGameDetailsCaches,
    events,
    connectivity
  }
}

test('install completion refills cached affected data of a closed page and keeps another game intact', async () => {
  const t = setup()
  const other = t.store.getEntry('gog:2')
  await t.events.installChanged('1', 'gog')
  expect(t.invalidateGameDetailsCaches).toHaveBeenCalledWith({
    appName: '1',
    runner: 'gog',
    scope: 'install'
  })
  expect(t.getInstallInfo).toHaveBeenCalledTimes(1)
  expect(t.ipc.getLaunchOptions).toHaveBeenCalledTimes(1)
  expect(t.ipc.requestGameSettings).toHaveBeenCalledTimes(1)
  expect(t.store.getSlot('settings:1', 'settings')?.data).toEqual({
    wineVersion: 'updated'
  })
  expect(t.store.getEntry('gog:2')).toBe(other)
})

test('failed backend invalidation fetches nothing and retains good slots', async () => {
  const t = setup()
  const before = t.store.getEntry('gog:1')
  t.invalidateGameDetailsCaches.mockResolvedValueOnce({
    dropped: [],
    failed: ['install'],
    art: { refreshed: 0, failed: 0 }
  })
  await t.events.installChanged('1', 'gog')
  expect(t.getInstallInfo).not.toHaveBeenCalled()
  expect(t.ipc.requestGameSettings).not.toHaveBeenCalled()
  expect(t.store.getSlot('gog:1', 'installInfo@Windows')).toBe(
    before?.slots['installInfo@Windows']
  )
  expect(t.store.getEntry('gog:1')?.pendingInstall).toBe(true)
})

test('failed local refills preserve persisted good data', async () => {
  const t = setup()
  const before = t.store.getSlot('gog:1', 'installInfo@Windows')
  t.getInstallInfo.mockRejectedValueOnce(Error('offline'))
  await t.events.installChanged('1', 'gog')
  expect(t.store.getSlot('gog:1', 'installInfo@Windows')).toBe(before)
  expect(t.store.getEntry('gog:1')?.pendingInstall).toBe(true)
})

test('a play session on a closed page refreshes achievements and settings', async () => {
  const t = setup()
  await t.events.played('1', 'gog')
  expect(t.invalidateGameDetailsCaches).toHaveBeenCalledWith({
    appName: '1',
    runner: 'gog',
    scope: 'achievements'
  })
  expect(t.ipc.clearAchievementCache).not.toHaveBeenCalled()
  expect(t.ipc.getAchievements).toHaveBeenCalledTimes(1)
  expect(t.store.getSlot('gog:1', 'achievements')?.data).toEqual([
    { name: 'new' }
  ])
  expect(t.store.getSlot('settings:1', 'settings')?.data).toEqual({
    wineVersion: 'updated'
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((release) => {
    resolve = release
  })
  return { promise, resolve }
}

test('clear during backend invalidation prevents the whole local event from recreating entries', async () => {
  const t = setup()
  const delayed = deferred<{
    dropped: never[]
    failed: string[]
    art: { refreshed: number; failed: number }
  }>()
  t.invalidateGameDetailsCaches.mockReturnValueOnce(delayed.promise)
  const completion = t.events.installChanged('1', 'gog')
  await t.store.clearAll()
  delayed.resolve({ dropped: [], failed: [], art: { refreshed: 0, failed: 0 } })
  await completion
  expect(t.getInstallInfo).not.toHaveBeenCalled()
  expect(t.ipc.requestGameSettings).not.toHaveBeenCalled()
  expect(t.store.keys()).toEqual([])
})

test('offline install completion retains shown info and refills only affected game after reconnect', async () => {
  const t = setup(false)
  const before = t.store.getSlot('gog:1', 'installInfo@Windows')
  const other = t.store.getEntry('gog:2')
  await t.events.installChanged('1', 'gog')
  expect(t.getInstallInfo).not.toHaveBeenCalled()
  expect(t.store.getSlot('gog:1', 'installInfo@Windows')).toBe(before)
  expect(t.store.getEntry('gog:1')?.pendingInstall).toBe(true)
  t.connectivity.online = true
  await t.events.reconnect()
  expect(t.getInstallInfo).toHaveBeenCalledTimes(1)
  expect(t.store.getSlot('gog:1', 'installInfo@Windows')?.data).toEqual({
    manifest: { disk_size: 2, download_size: 1 }
  })
  expect(t.store.getEntry('gog:1')?.pendingInstall).toBe(false)
  expect(t.store.getEntry('gog:2')).toBe(other)
})

test('offline play completion persists its targeted work and reconnect refreshes achievements', async () => {
  const t = setup(false)
  const before = t.store.getSlot('gog:1', 'achievements')
  await t.events.played('1', 'gog')
  expect(t.store.getSlot('gog:1', 'achievements')).toBe(before)
  expect(t.store.getEntry('gog:1')?.pendingPlay).toBe(true)
  t.connectivity.online = true
  await t.events.reconnect()
  expect(t.ipc.getAchievements).toHaveBeenCalledTimes(1)
  expect(t.store.getEntry('gog:1')?.pendingPlay).toBe(false)
})

test('play completion holds refill until targeted backend invalidation finishes', async () => {
  const t = setup()
  const delayed = deferred<{
    dropped: never[]
    failed: string[]
    art: { refreshed: number; failed: number }
  }>()
  t.invalidateGameDetailsCaches.mockReturnValueOnce(delayed.promise)
  const completion = t.events.played('1', 'gog')
  await Promise.resolve()
  expect(t.ipc.getAchievements).not.toHaveBeenCalled()
  delayed.resolve({ dropped: [], failed: [], art: { refreshed: 0, failed: 0 } })
  await completion
  expect(t.ipc.getAchievements).toHaveBeenCalledTimes(1)
})

test('pending offline work survives renderer persistence and only affected slots refill after restart', async () => {
  const t = setup(false)
  await t.events.played('1', 'gog')
  const persistence = new MemoryPersistence()
  for (const key of t.store.keys())
    persistence.data.set(key, t.store.getEntry(key)!)
  const restarted = createGameDetailsStore(persistence, {
    scheduleNotify: () => undefined
  })
  await restarted.hydrate()
  const gameDetailsApi = createGameDetailsApi(restarted, {
    ipc: () => t.ipc as unknown as DetailsIpc,
    getInstallInfo: t.getInstallInfo as never,
    platform: 'linux',
    getLanguage: () => 'en',
    getLibraryGame: () => undefined,
    isOnline: () => true
  })
  const events = createLocalEvents({
    gameDetailsApi,
    store: restarted,
    invalidateGameDetailsCaches: t.invalidateGameDetailsCaches,
    isOnline: () => true
  })
  await events.reconnect()
  expect(t.ipc.getAchievements).toHaveBeenCalledTimes(1)
  expect(t.getInstallInfo).not.toHaveBeenCalled()
  expect(restarted.getEntry('gog:1')?.pendingPlay).toBe(false)
  await restarted.flush()
})

test('install completion waits for hydration before discovering persisted platform and settings slots', async () => {
  const persistence = new MemoryPersistence()
  const loading = deferred<Awaited<ReturnType<typeof persistence.loadAll>>>()
  jest.spyOn(persistence, 'loadAll').mockReturnValueOnce(loading.promise)
  const t = setup(true, persistence, false)
  const completion = t.events.installChanged('1', 'gog')
  await Promise.resolve()
  expect(t.getInstallInfo).not.toHaveBeenCalled()
  expect(t.store.getEntry('gog:1')?.pendingInstall).toBe(true)
  loading.resolve({
    'gog:1': {
      slots: {
        'installInfo@Windows': { data: { manifest: { disk_size: 1 } } },
        'installInfo@linux': { data: { manifest: { disk_size: 1 } } },
        launchOptions: { data: [{ name: 'old' }] }
      }
    },
    'settings:1': { slots: { settings: { data: { wineVersion: 'old' } } } }
  })
  await completion
  expect(t.getInstallInfo).toHaveBeenCalledTimes(2)
  expect(t.ipc.requestGameSettings).toHaveBeenCalledTimes(1)
  expect(t.ipc.getLaunchOptions).toHaveBeenCalledTimes(1)
  expect(t.store.getEntry('gog:1')?.pendingInstall).toBe(false)
})

test('play completion before hydration retains offline work and reconciles persisted achievements on reconnect', async () => {
  const persistence = new MemoryPersistence()
  const loading = deferred<Awaited<ReturnType<typeof persistence.loadAll>>>()
  jest.spyOn(persistence, 'loadAll').mockReturnValueOnce(loading.promise)
  const t = setup(false, persistence, false)
  const completion = t.events.played('1', 'gog')
  loading.resolve({
    'gog:1': { slots: { achievements: { data: [{ name: 'old' }] } } }
  })
  await completion
  expect(t.store.getEntry('gog:1')?.pendingPlay).toBe(true)
  expect(t.ipc.getAchievements).not.toHaveBeenCalled()
  t.connectivity.online = true
  await t.events.reconnect()
  expect(t.ipc.getAchievements).toHaveBeenCalledTimes(1)
  expect(t.store.getSlot('gog:1', 'achievements')?.data).toEqual([
    { name: 'new' }
  ])
})

test('removal while waiting for hydration fences the entire deferred event', async () => {
  const persistence = new MemoryPersistence()
  const loading = deferred<Awaited<ReturnType<typeof persistence.loadAll>>>()
  jest.spyOn(persistence, 'loadAll').mockReturnValueOnce(loading.promise)
  const t = setup(true, persistence, false)
  const completion = t.events.played('1', 'gog')
  t.store.removeKeys(['gog:1'])
  loading.resolve({
    'gog:1': { slots: { achievements: { data: [{ name: 'old' }] } } }
  })
  await completion
  expect(t.ipc.getAchievements).not.toHaveBeenCalled()
  expect(t.store.getEntry('gog:1')).toBeUndefined()
})

test('settings edit during install invalidation preserves settings and allows unrelated refills', async () => {
  const t = setup()
  const delayed =
    deferred<Awaited<ReturnType<typeof t.invalidateGameDetailsCaches>>>()
  t.invalidateGameDetailsCaches.mockReturnValueOnce(delayed.promise)
  const completion = t.events.installChanged('1', 'gog')
  t.gameDetailsApi.invalidateSettings('1')
  t.store.setSlot('settings:1', 'settings', { wineVersion: 'edited' })
  delayed.resolve({ dropped: [], failed: [], art: { refreshed: 0, failed: 0 } })
  await completion
  expect(t.getInstallInfo).toHaveBeenCalledTimes(1)
  expect(t.ipc.getLaunchOptions).toHaveBeenCalledTimes(1)
  expect(t.ipc.requestGameSettings).not.toHaveBeenCalled()
  expect(t.store.getSlot('settings:1', 'settings')?.data).toEqual({
    wineVersion: 'edited'
  })
  expect(t.store.getEntry('gog:1')?.pendingInstall).toBe(false)
})

test('settings edit during play invalidation does not cancel achievement refill', async () => {
  const t = setup()
  const delayed =
    deferred<Awaited<ReturnType<typeof t.invalidateGameDetailsCaches>>>()
  t.invalidateGameDetailsCaches.mockReturnValueOnce(delayed.promise)
  const completion = t.events.played('1', 'gog')
  t.gameDetailsApi.invalidateSettings('1')
  t.store.setSlot('settings:1', 'settings', { wineVersion: 'edited' })
  delayed.resolve({ dropped: [], failed: [], art: { refreshed: 0, failed: 0 } })
  await completion
  expect(t.ipc.getAchievements).toHaveBeenCalledTimes(1)
  expect(t.ipc.requestGameSettings).not.toHaveBeenCalled()
  expect(t.store.getEntry('gog:1')?.pendingPlay).toBe(false)
})
