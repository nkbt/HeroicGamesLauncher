import { createDetailsConnectivity } from '../connectivity'
import { createGameDetailsApi, type DetailsIpc } from '../api'
import { createGameDetailsStore } from '../store'
import { MemoryPersistence } from '../persistence'

test('checking/offline endpoint status never counts empty wiki attempts even if browser networking is available', async () => {
  const connectivity = createDetailsConnectivity(jest.fn())
  let changed!: (event: unknown, connectivity: { status: string }) => void
  const unsubscribe = jest.fn()
  connectivity.listen({
    onConnectivityChanged: (listener) => {
      changed = listener
      return unsubscribe
    }
  })
  const store = createGameDetailsStore(new MemoryPersistence(), {
    scheduleNotify: () => undefined
  })
  const gameDetailsApi = createGameDetailsApi(store, {
    ipc: () =>
      ({
        getWikiGameInfo: () => Promise.resolve(null)
      }) as unknown as DetailsIpc,
    getInstallInfo: () => Promise.resolve(null),
    platform: 'linux',
    getLanguage: () => 'en',
    getLibraryGame: () => undefined,
    isOnline: connectivity.isOnline
  })
  expect(connectivity.isOnline()).toBe(false)
  await gameDetailsApi.getWikiGameInfo('Synthetic title', 'game-a', 'gog')
  changed({}, { status: 'offline' })
  await gameDetailsApi.getWikiGameInfo('Synthetic title', 'game-a', 'gog')
  expect(store.getEntry('gog:game-a')?.wikiEmpty).toBeUndefined()
  expect(store.getSlot('gog:game-a', 'wikiInfo')).toBeUndefined()
})

test('an older initial connectivity read cannot replace a newer endpoint event', async () => {
  const onOnline = jest.fn()
  const connectivity = createDetailsConnectivity(onOnline)
  let resolve!: (connectivity: { status: string }) => void
  const initial = new Promise<{ status: string }>((release) => {
    resolve = release
  })
  let changed!: (event: unknown, connectivity: { status: string }) => void
  const unsubscribe = jest.fn()
  const cleanup = connectivity.listen({
    getConnectivityStatus: () => initial,
    onConnectivityChanged: (listener) => {
      changed = listener
      return unsubscribe
    }
  })
  changed({}, { status: 'offline' })
  resolve({ status: 'online' })
  await initial
  expect(connectivity.isOnline()).toBe(false)
  expect(onOnline).not.toHaveBeenCalled()
  changed({}, { status: 'online' })
  expect(onOnline).toHaveBeenCalledTimes(1)
  cleanup?.()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})
