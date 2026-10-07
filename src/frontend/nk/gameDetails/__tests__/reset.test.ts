import { createGameDetailsApi, type DetailsIpc } from '../api'
import { MemoryPersistence } from '../persistence'
import { listenToResetGameDetails } from '../reset'
import { createGameDetailsStore } from '../store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((release) => {
    resolve = release
  })
  return { promise, resolve }
}

function setup(persistence = new MemoryPersistence()) {
  const store = createGameDetailsStore(persistence, {
    scheduleNotify: () => undefined,
    warn: jest.fn()
  })
  let listener!: (event: unknown, requestId: number) => void
  const cleanup = jest.fn()
  const cancelCleanup = jest.fn()
  let cancelled!: (event: unknown, requestId: number) => void
  const resetApi = {
    handleResetGameDetails: jest.fn((next: typeof listener) => {
      listener = next
      return cleanup
    }),
    handleResetGameDetailsCancelled: jest.fn((listener: typeof cancelled) => {
      cancelled = listener
      return cancelCleanup
    }),
    gameDetailsResetReady: jest.fn()
  }
  const prepareReset = jest.spyOn(store, 'prepareReset')
  const unsubscribe = listenToResetGameDetails(store, resetApi)
  return {
    store,
    persistence,
    prepareReset,
    resetApi,
    unsubscribe,
    cleanup,
    cancel: (requestId: number) => cancelled({}, requestId),
    reset: (requestId: number) => listener({}, requestId)
  }
}

test('route-independent reset waits for pending persistence and prevents writes and hydration from resurrecting settings', async () => {
  const t = setup()
  t.store.setSlot('settings:game-a', 'settings', { wineVersion: 'obsolete' })
  const writing = deferred<void>()
  const original = t.persistence.putMany.bind(t.persistence)
  jest
    .spyOn(t.persistence, 'putMany')
    .mockImplementationOnce(async (puts, signal) => {
      await writing.promise
      await original(puts, signal)
    })
  const flush = t.store.flush()
  await Promise.resolve()
  const loading = deferred<Record<string, never>>()
  jest.spyOn(t.persistence, 'loadAll').mockReturnValueOnce(loading.promise)
  const hydration = t.store.hydrate()
  t.reset(7)
  t.store.setSlot('settings:game-a', 'settings', {
    wineVersion: 'stale completion'
  })
  expect(t.resetApi.gameDetailsResetReady).not.toHaveBeenCalled()
  writing.resolve()
  await flush
  await Promise.resolve()
  await Promise.resolve()
  loading.resolve({})
  await hydration
  await Promise.resolve()
  expect(t.resetApi.gameDetailsResetReady).toHaveBeenCalledWith(7, true)
  expect(t.store.keys()).toEqual([])
  const restarted = createGameDetailsStore(t.persistence)
  await restarted.hydrate()
  expect(restarted.getSlot('settings:game-a', 'settings')).toBeUndefined()
  const requestGameSettings = jest.fn(() =>
    Promise.resolve({ wineVersion: 'default' })
  )
  const gameDetailsApi = createGameDetailsApi(restarted, {
    ipc: () => ({ requestGameSettings }) as unknown as DetailsIpc,
    getInstallInfo: () => Promise.resolve(null),
    platform: 'linux',
    getLanguage: () => 'en',
    getLibraryGame: () => undefined,
    isOnline: () => true
  })
  expect(await gameDetailsApi.requestGameSettings('game-a')).toEqual({
    wineVersion: 'default'
  })
  expect(requestGameSettings).toHaveBeenCalledTimes(1)
  await restarted.flush()
  t.unsubscribe()
  expect(t.cleanup).toHaveBeenCalledTimes(1)
})

test('failed IndexedDB clear reports failure and cannot acknowledge a successful reset', async () => {
  const t = setup()
  jest
    .spyOn(t.persistence, 'clear')
    .mockRejectedValueOnce(Error('transaction failed'))
  t.reset(8)
  await (t.prepareReset.mock.results[0].value as Promise<void>).catch(
    () => undefined
  )
  expect(t.resetApi.gameDetailsResetReady).toHaveBeenCalledWith(8, false)
  expect(t.resetApi.gameDetailsResetReady).not.toHaveBeenCalledWith(8, true)
  t.unsubscribe()
})

test('a cancelled non-settling clear immediately resumes ordinary cache writes', async () => {
  const t = setup()
  const clearing = deferred<void>()
  jest.spyOn(t.persistence, 'clear').mockReturnValueOnce(clearing.promise)
  t.reset(9)
  await Promise.resolve()
  t.cancel(9)
  t.store.setSlot('settings:game-a', 'settings', { wineVersion: 'current' })
  await t.store.flush()
  await (t.prepareReset.mock.results[0].value as Promise<void>).catch(
    () => undefined
  )
  expect(t.resetApi.gameDetailsResetReady).not.toHaveBeenCalled()
  expect(
    t.persistence.data.get('settings:game-a')?.slots.settings?.data
  ).toEqual({ wineVersion: 'current' })
  clearing.resolve()
  await Promise.resolve()
  expect(t.store.getSlot('settings:game-a', 'settings')?.data).toEqual({
    wineVersion: 'current'
  })
  t.unsubscribe()
})

test('cancelled wait for an older write never starts a late destructive clear', async () => {
  const t = setup()
  t.store.setSlot('settings:game-a', 'settings', { wineVersion: 'old' })
  const writing = deferred<void>()
  const original = t.persistence.putMany.bind(t.persistence)
  jest
    .spyOn(t.persistence, 'putMany')
    .mockImplementationOnce(async (puts, signal) => {
      await writing.promise
      await original(puts, signal)
    })
  const clear = jest.spyOn(t.persistence, 'clear')
  const flushing = t.store.flush()
  await Promise.resolve()
  t.reset(10)
  t.cancel(10)
  t.store.setSlot('settings:game-a', 'settings', { wineVersion: 'new' })
  writing.resolve()
  await flushing
  await t.store.flush()
  expect(clear).not.toHaveBeenCalled()
  expect(
    t.persistence.data.get('settings:game-a')?.slots.settings?.data
  ).toEqual({ wineVersion: 'new' })
  expect(t.resetApi.gameDetailsResetReady).not.toHaveBeenCalled()
  t.unsubscribe()
})

test('cancellation detaches a non-settling older write and fences its eventual resolution', async () => {
  const t = setup()
  const writing = deferred<void>()
  const original = t.persistence.putMany.bind(t.persistence)
  jest
    .spyOn(t.persistence, 'putMany')
    .mockImplementationOnce(async (puts, signal) => {
      await writing.promise
      await original(puts, signal)
    })
  t.store.setSlot('settings:game-a', 'settings', { wineVersion: 'old' })
  const oldFlush = t.store.flush()
  await Promise.resolve()
  t.reset(11)
  t.cancel(11)
  t.store.setSlot('settings:game-a', 'settings', { wineVersion: 'new' })
  await t.store.flush()
  expect(
    t.persistence.data.get('settings:game-a')?.slots.settings?.data
  ).toEqual({ wineVersion: 'new' })
  writing.resolve()
  await oldFlush
  await Promise.resolve()
  expect(
    t.persistence.data.get('settings:game-a')?.slots.settings?.data
  ).toEqual({ wineVersion: 'new' })
  expect(t.resetApi.gameDetailsResetReady).not.toHaveBeenCalled()
  t.unsubscribe()
})

test('late rejection of an abandoned write cannot poison the recovered persistence queue', async () => {
  const t = setup()
  let reject!: (error: Error) => void
  const writing = new Promise<void>((_resolve, fail) => {
    reject = fail
  })
  jest.spyOn(t.persistence, 'putMany').mockReturnValueOnce(writing)
  t.store.setSlot('settings:game-a', 'settings', { wineVersion: 'old' })
  const oldFlush = t.store.flush()
  await Promise.resolve()
  t.reset(12)
  t.cancel(12)
  t.store.setSlot('settings:game-a', 'settings', { wineVersion: 'new' })
  await t.store.flush()
  reject(Error('late write failure'))
  await oldFlush
  t.store.setSlot('settings:game-a', 'settings', { wineVersion: 'latest' })
  await t.store.flush()
  expect(
    t.persistence.data.get('settings:game-a')?.slots.settings?.data
  ).toEqual({ wineVersion: 'latest' })
  t.unsubscribe()
})
