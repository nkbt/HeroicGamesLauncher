jest.mock('i18next', () => ({ __esModule: true, default: { language: 'en' } }))
import type { GameSettings } from 'common/types'
import type { MemoryPersistence } from '../persistence'

function setup(
  loading?: Promise<Awaited<ReturnType<MemoryPersistence['loadAll']>>>
) {
  let status!: Parameters<typeof window.api.handleGameStatus>[0]
  window.api.handleGameStatus = jest.fn((listener) => {
    status = listener
    return () => undefined
  })
  window.api.invalidateGameDetailsCaches = jest.fn(() =>
    Promise.resolve({
      dropped: [],
      failed: [],
      art: { refreshed: 0, failed: 0 }
    })
  )
  window.api.requestGameSettings = jest.fn(() =>
    Promise.resolve({ wineVersion: 'updated' } as unknown as GameSettings)
  )
  let gameDetailsScheduler!: (typeof import('../instance'))['gameDetailsScheduler']
  let gameDetailsPrefetch!: (typeof import('../instance'))['gameDetailsPrefetch']
  let setLanguage!: (language: string) => void
  let gameDetailsStore!: (typeof import('../instance'))['gameDetailsStore']
  let gameDetailsApi!: (typeof import('../instance'))['gameDetailsApi']
  jest.isolateModules(() => {
    if (loading) {
      const { MemoryPersistence } =
        jest.requireActual<typeof import('../persistence')>('../persistence')
      jest
        .spyOn(MemoryPersistence.prototype, 'loadAll')
        .mockReturnValueOnce(loading)
    }
    const instance =
      jest.requireActual<typeof import('../instance')>('../instance')
    gameDetailsScheduler = instance.gameDetailsScheduler
    gameDetailsPrefetch = instance.gameDetailsPrefetch
    const language = jest.requireMock<{ default: { language: string } }>(
      'i18next'
    ).default
    setLanguage = (value) => {
      language.language = value
    }
    gameDetailsStore = instance.gameDetailsStore
    gameDetailsApi = instance.gameDetailsApi
  })
  return {
    status,
    gameDetailsStore,
    gameDetailsApi,
    gameDetailsScheduler,
    gameDetailsPrefetch,
    setLanguage
  }
}

test('runner-less download completion uses its preceding operation runner before hydration', async () => {
  let load!: (
    entries: Awaited<ReturnType<MemoryPersistence['loadAll']>>
  ) => void
  const loading = new Promise<
    Awaited<ReturnType<MemoryPersistence['loadAll']>>
  >((resolve) => {
    load = resolve
  })
  const { status, gameDetailsStore, gameDetailsApi } = setup(loading)
  let requested!: () => void
  const requestStarted = new Promise<void>((resolve) => {
    requested = resolve
  })
  jest.mocked(window.api.requestGameSettings).mockImplementation(() => {
    requested()
    return Promise.resolve({
      wineVersion: 'updated'
    } as unknown as GameSettings)
  })
  status({} as never, {
    appName: 'game-a',
    runner: 'gog',
    status: 'installing'
  })
  status({} as never, {
    appName: 'game-a',
    runner: 'gog',
    status: 'installing'
  })
  status({} as never, { appName: 'game-a', status: 'done' })
  await Promise.resolve()
  expect(window.api.invalidateGameDetailsCaches).toHaveBeenCalledWith({
    appName: 'game-a',
    runner: 'gog',
    scope: 'install'
  })
  expect(gameDetailsStore.getEntry('gog:game-a')?.pendingInstall).toBe(true)
  load({
    'settings:game-a': { slots: { settings: { data: { wineVersion: 'old' } } } }
  })
  await gameDetailsStore.hydrationReady
  await requestStarted
  await gameDetailsApi.requestGameSettings('game-a', { force: true })
  expect(window.api.requestGameSettings).toHaveBeenCalledTimes(1)
  expect(gameDetailsStore.getSlot('settings:game-a', 'settings')?.data).toEqual(
    { wineVersion: 'updated' }
  )
  jest.restoreAllMocks()
  await gameDetailsStore.clearAll()
})

test('runner-less done after cache clear cannot revive the old operation, and a new operation remains valid', async () => {
  const { status, gameDetailsStore } = setup()
  const invalidate = jest.mocked(window.api.invalidateGameDetailsCaches)
  invalidate.mockClear()
  status({} as never, {
    appName: 'game-b',
    runner: 'gog',
    status: 'installing'
  })
  await gameDetailsStore.clearAll()
  status({} as never, { appName: 'game-b', status: 'done' })
  await Promise.resolve()
  expect(invalidate).not.toHaveBeenCalled()
  expect(gameDetailsStore.getEntry('gog:game-b')).toBeUndefined()
  status({} as never, {
    appName: 'game-b',
    runner: 'gog',
    status: 'installing'
  })
  status({} as never, { appName: 'game-b', status: 'done' })
  await Promise.resolve()
  expect(invalidate).toHaveBeenCalledTimes(1)
  expect(gameDetailsStore.getEntry('gog:game-b')?.pendingInstall).toBe(true)
  await gameDetailsStore.clearAll()
})

test('runner-less done after removal cannot restore a removed game and does not affect another store identity', async () => {
  const { status, gameDetailsStore } = setup()
  const invalidate = jest.mocked(window.api.invalidateGameDetailsCaches)
  invalidate.mockClear()
  gameDetailsStore.setSlot('gog:game-c', 'launchOptions', [])
  gameDetailsStore.setSlot('legendary:game-c', 'launchOptions', [
    { name: 'retained' }
  ])
  const other = gameDetailsStore.getEntry('legendary:game-c')
  status({} as never, { appName: 'game-c', runner: 'gog', status: 'updating' })
  gameDetailsStore.removeKeys(['gog:game-c'])
  status({} as never, { appName: 'game-c', status: 'done' })
  await Promise.resolve()
  expect(invalidate).not.toHaveBeenCalled()
  expect(gameDetailsStore.getEntry('gog:game-c')).toBeUndefined()
  expect(gameDetailsStore.getEntry('legendary:game-c')).toBe(other)
  status({} as never, {
    appName: 'game-c',
    runner: 'gog',
    status: 'installing'
  })
  status({} as never, { appName: 'game-c', status: 'done' })
  await Promise.resolve()
  expect(invalidate).toHaveBeenCalledWith({
    appName: 'game-c',
    runner: 'gog',
    scope: 'install'
  })
  await gameDetailsStore.clearAll()
})

test('same app names in two active stores never assign an ambiguous runner-less completion', async () => {
  const { status, gameDetailsStore } = setup()
  const invalidate = jest.mocked(window.api.invalidateGameDetailsCaches)
  invalidate.mockClear()
  status({} as never, {
    appName: 'game-d',
    runner: 'gog',
    status: 'installing'
  })
  status({} as never, {
    appName: 'game-d',
    runner: 'legendary',
    status: 'updating'
  })
  status({} as never, { appName: 'game-d', status: 'done' })
  await Promise.resolve()
  expect(invalidate).not.toHaveBeenCalled()
  status({} as never, { appName: 'game-d', runner: 'gog', status: 'done' })
  await Promise.resolve()
  expect(invalidate).toHaveBeenCalledTimes(1)
  expect(invalidate).toHaveBeenCalledWith({
    appName: 'game-d',
    runner: 'gog',
    scope: 'install'
  })
  await gameDetailsStore.clearAll()
})

test('duplicate updating after clear retains obsolete start provenance until terminal completion', async () => {
  const { status, gameDetailsStore } = setup()
  const invalidate = jest.mocked(window.api.invalidateGameDetailsCaches)
  status({} as never, {
    appName: 'game-e',
    runner: 'legendary',
    status: 'updating'
  })
  await gameDetailsStore.clearAll()
  status({} as never, {
    appName: 'game-e',
    runner: 'legendary',
    status: 'updating'
  })
  status({} as never, { appName: 'game-e', status: 'done' })
  await Promise.resolve()
  expect(invalidate).not.toHaveBeenCalled()
  expect(gameDetailsStore.getEntry('legendary:game-e')).toBeUndefined()
  status({} as never, {
    appName: 'game-e',
    runner: 'legendary',
    status: 'updating'
  })
  status({} as never, { appName: 'game-e', status: 'done' })
  await Promise.resolve()
  expect(invalidate).toHaveBeenCalledTimes(1)
  expect(invalidate).toHaveBeenCalledWith({
    appName: 'game-e',
    runner: 'legendary',
    scope: 'install'
  })
  expect(gameDetailsStore.getEntry('legendary:game-e')?.pendingInstall).toBe(
    true
  )
  await gameDetailsStore.clearAll()
})

test('duplicate updating after removal cannot rebind the removed operation to the current version', async () => {
  const { status, gameDetailsStore } = setup()
  const invalidate = jest.mocked(window.api.invalidateGameDetailsCaches)
  gameDetailsStore.setSlot('legendary:game-f', 'launchOptions', [
    { name: 'old' }
  ])
  status({} as never, {
    appName: 'game-f',
    runner: 'legendary',
    status: 'updating'
  })
  gameDetailsStore.removeKeys(['legendary:game-f'])
  status({} as never, {
    appName: 'game-f',
    runner: 'legendary',
    status: 'updating'
  })
  status({} as never, { appName: 'game-f', status: 'done' })
  await Promise.resolve()
  expect(invalidate).not.toHaveBeenCalled()
  expect(gameDetailsStore.getEntry('legendary:game-f')).toBeUndefined()
  status({} as never, {
    appName: 'game-f',
    runner: 'legendary',
    status: 'updating'
  })
  status({} as never, { appName: 'game-f', status: 'done' })
  await Promise.resolve()
  expect(invalidate).toHaveBeenCalledTimes(1)
  expect(gameDetailsStore.getEntry('legendary:game-f')?.pendingInstall).toBe(
    true
  )
  await gameDetailsStore.clearAll()
})

async function languageCompletion(selectedBeforeCompletion: boolean) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null }
  })
  const t = setup()
  await t.gameDetailsStore.hydrationReady
  const gameInfo = {
    runner: 'gog',
    app_name: 'language-game',
    title: 'Synthetic Coast',
    is_installed: true,
    install: { platform: 'Windows' }
  } as import('common/types').GameInfo
  window.api.getExtraInfo = jest.fn(() =>
    Promise.resolve({
      storeUrl: 'https://store.example/language'
    } as import('common/types').ExtraInfo)
  )
  window.api.getAchievements = jest.fn(() => Promise.resolve([]))
  t.gameDetailsStore.setSlot('gog:language-game', 'extraInfo@en', {
    storeUrl: 'https://store.example/en'
  })
  t.gameDetailsStore.setSlot('gog:language-game', 'achievements', [])
  t.gameDetailsScheduler.update({ online: true })
  t.status({} as never, {
    appName: 'language-game',
    runner: 'gog',
    status: 'playing'
  })
  t.setLanguage('fr')
  const french = t.gameDetailsPrefetch.prefetch(gameInfo, 2, true)
  await Promise.resolve()
  await Promise.resolve()
  if (selectedBeforeCompletion)
    t.gameDetailsScheduler.update({ playing: false })
  t.status({} as never, {
    appName: 'language-game',
    runner: 'gog',
    status: 'done'
  })
  await french
  expect(window.api.getExtraInfo).toHaveBeenCalledTimes(1)
  expect(
    t.gameDetailsStore.getSlot('gog:language-game', 'extraInfo@fr')
  ).toBeDefined()
  expect(window.api.invalidateGameDetailsCaches).toHaveBeenCalledWith({
    appName: 'language-game',
    runner: 'gog',
    scope: 'achievements'
  })
  t.gameDetailsScheduler.dispose()
  await t.gameDetailsStore.clearAll()
}
test('actual play completion retains queued missing language work', async () => {
  await languageCompletion(false)
})
test('actual play completion retains just-selected missing language work', async () => {
  await languageCompletion(true)
})
