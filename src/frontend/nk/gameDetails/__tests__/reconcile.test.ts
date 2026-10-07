import type { ExtraInfo, InstallInfo } from 'common/types'
import { createDetailsReconciliation } from '../reconcile'
import { listSigOf } from '../logic'
import { MemoryPersistence } from '../persistence'
import { createLocalEvents } from '../localEvents'
import { gameInfo, phase2Fixture, tick } from './phase2Fixtures'
afterEach(() => {
  jest.useRealTimers()
})
const invalidate = () =>
  jest.fn(() =>
    Promise.resolve({
      dropped: [],
      failed: [],
      art: { refreshed: 0, failed: 0 }
    })
  )
test('unsigned hydrated slots gain only observation provenance and survive equal refresh and restart without fetch', async () => {
  const persistence = new MemoryPersistence()
  await persistence.putMany([
    [
      'legendary:game-a',
      {
        slots: {
          'extraInfo@en': { data: { storeUrl: 'https://store.example/old' } }
        }
      }
    ]
  ])
  const fixture = phase2Fixture(persistence)
  await fixture.store.hydrate()
  const invalidation = invalidate()
  const reconciliation = createDetailsReconciliation(
    fixture.store,
    fixture.gameDetailsApi,
    invalidation,
    'linux',
    fixture.language
  )
  reconciliation.observe(gameInfo)
  reconciliation.observe({ ...gameInfo })
  await fixture.store.flush()
  expect(fixture.store.getEntry('legendary:game-a')?.observedListSig).toEqual(
    listSigOf(gameInfo)
  )
  expect(
    fixture.store.getEntry('legendary:game-a')?.listSig?.meta
  ).toBeUndefined()
  const restarted = phase2Fixture(persistence)
  await restarted.store.hydrate()
  createDetailsReconciliation(
    restarted.store,
    restarted.gameDetailsApi,
    invalidation,
    'linux',
    restarted.language
  ).observe({ ...gameInfo })
  expect(invalidation).not.toHaveBeenCalled()
  expect(fixture.ipc.getExtraInfo).not.toHaveBeenCalled()
  expect(restarted.ipc.getExtraInfo).not.toHaveBeenCalled()
})
test('a real metadata change refills only metadata and a partial failure keeps verified provenance absent', async () => {
  const fixture = phase2Fixture()
  await fixture.store.hydrate()
  fixture.store.setSlot('legendary:game-a', 'extraInfo@en', {
    storeUrl: 'https://store.example/old'
  })
  const invalidation = invalidate()
  const reconciliation = createDetailsReconciliation(
    fixture.store,
    fixture.gameDetailsApi,
    invalidation,
    'linux',
    fixture.language
  )
  reconciliation.observe(gameInfo)
  const changed = { ...gameInfo, title: 'Synthetic Summit' }
  fixture.setLibraryGame(changed)
  jest.mocked(fixture.ipc.getExtraInfo).mockResolvedValueOnce({
    storeUrl: '',
    about: { description: '' },
    reqs: []
  } as unknown as ExtraInfo)
  reconciliation.observe(changed)
  await tick()
  await tick()
  await tick()
  expect(invalidation).toHaveBeenCalledWith({
    runner: 'legendary',
    appName: 'game-a',
    scope: 'meta'
  })
  expect(fixture.ipc.requestGameSettings).not.toHaveBeenCalled()
  expect(fixture.getInstallInfo).not.toHaveBeenCalled()
  expect(
    fixture.store.getEntry('legendary:game-a')?.listSig?.meta
  ).toBeUndefined()
  expect(fixture.store.getEntry('legendary:game-a')?.pendingListSig?.meta).toBe(
    listSigOf(changed).meta
  )
  expect(
    fixture.store.getSlot('legendary:game-a', 'extraInfo@en')?.data
  ).toEqual({ storeUrl: 'https://store.example/old' })
})

test('event refill attaches the updated list signature once and does not suppress a later real install change', async () => {
  const fixture = phase2Fixture()
  await fixture.store.hydrate()
  fixture.store.setSlot('legendary:game-a', 'installInfo@Windows', {})
  fixture.store.setSlot('legendary:game-a', 'launchOptions', [])
  fixture.store.setSlot('settings:game-a', 'settings', {})
  const invalidation = invalidate()
  const reconciliation = createDetailsReconciliation(
    fixture.store,
    fixture.gameDetailsApi,
    invalidation,
    'linux',
    fixture.language
  )
  reconciliation.observe(gameInfo)
  let latest = gameInfo
  let resolve!: (value: InstallInfo) => void
  let requested!: () => void
  const started = new Promise<void>((yes) => {
    requested = yes
  })
  fixture.getInstallInfo.mockImplementationOnce(
    () =>
      new Promise<InstallInfo>((yes) => {
        resolve = yes
        requested()
      })
  )
  const events = createLocalEvents({
    gameDetailsApi: fixture.gameDetailsApi,
    store: fixture.store,
    invalidateGameDetailsCaches: invalidation,
    isOnline: () => true,
    getLibraryGame: () => latest
  })
  const event = events.installChanged('game-a', 'legendary')
  await started
  latest = {
    ...gameInfo,
    is_installed: true,
    install: { ...gameInfo.install, version: 'synthetic-2' }
  }
  fixture.setLibraryGame(latest)
  reconciliation.observe(latest)
  expect(invalidation).toHaveBeenCalledTimes(1)
  resolve({ manifest: { disk_size: 8, download_size: 4 } } as InstallInfo)
  await event
  reconciliation.observe({ ...latest })
  expect(fixture.store.getEntry('legendary:game-a')?.listSig?.install).toBe(
    listSigOf(latest).install
  )
  expect(invalidation).toHaveBeenCalledTimes(1)
  latest = { ...latest, install: { ...latest.install, version: 'synthetic-3' } }
  fixture.setLibraryGame(latest)
  reconciliation.observe(latest)
  await tick()
  expect(invalidation).toHaveBeenCalledTimes(2)
  fixture.scheduler.update({ enabled: false })
})

test('successive paused metadata and install changes invalidate both backend groups before refill', async () => {
  jest.useFakeTimers()
  const fixture = phase2Fixture()
  await fixture.store.hydrate()
  fixture.store.setSlot('legendary:game-a', 'extraInfo@en', {
    storeUrl: 'https://store.example/old'
  })
  fixture.store.setSlot('legendary:game-a', 'installInfo@Windows', {
    manifest: { disk_size: 1 }
  })
  const calls: string[] = []
  const invalidation = jest.fn((request: { scope?: string }) => {
    calls.push(`invalidate:${request.scope}`)
    return Promise.resolve({
      dropped: [],
      failed: [],
      art: { refreshed: 0, failed: 0 }
    })
  })
  fixture.getInstallInfo.mockImplementation(() => {
    calls.push('install-fetch')
    expect(calls).toContain('invalidate:install')
    return Promise.resolve({ manifest: { disk_size: 9 } } as InstallInfo)
  })
  const reconciliation = createDetailsReconciliation(
    fixture.store,
    fixture.gameDetailsApi,
    invalidation,
    'linux',
    fixture.language
  )
  reconciliation.observe(gameInfo)
  fixture.scheduler.update({ playing: true })
  const metadata = { ...gameInfo, title: 'Synthetic Summit' }
  fixture.setLibraryGame(metadata)
  reconciliation.observe(metadata)
  const installed = {
    ...metadata,
    is_installed: true,
    install: { ...metadata.install, version: '2' }
  }
  fixture.setLibraryGame(installed)
  reconciliation.observe(installed)
  fixture.scheduler.update({ playing: false })
  await tick()
  await tick()
  await tick()
  await tick()
  await tick()
  await jest.advanceTimersByTimeAsync(4000)
  expect(calls).toContain('invalidate:meta')
  expect(calls).toContain('invalidate:install')
  expect(fixture.store.getEntry('legendary:game-a')?.listSig?.install).toBe(
    listSigOf(installed).install
  )
})

test('pending failed reconciliation is provenance without equal-observation or remount retry authorization', async () => {
  jest.useFakeTimers()
  const fixture = phase2Fixture()
  await fixture.store.hydrate()
  fixture.store.setSlot('legendary:game-a', 'extraInfo@en', {
    storeUrl: 'https://store.example/old'
  })
  const invalidation = invalidate()
  const reconciliation = createDetailsReconciliation(
    fixture.store,
    fixture.gameDetailsApi,
    invalidation,
    'linux',
    fixture.language
  )
  reconciliation.observe(gameInfo)
  const changed = { ...gameInfo, title: 'Synthetic Summit' }
  fixture.setLibraryGame(changed)
  jest
    .mocked(fixture.ipc.getExtraInfo)
    .mockRejectedValueOnce(new Error('synthetic failure'))
  reconciliation.observe(changed)
  await tick()
  await tick()
  await tick()
  await tick()
  expect(fixture.store.getEntry('legendary:game-a')?.pendingListSig?.meta).toBe(
    listSigOf(changed).meta
  )
  reconciliation.observe({ ...changed })
  createDetailsReconciliation(
    fixture.store,
    fixture.gameDetailsApi,
    invalidation,
    'linux',
    fixture.language
  ).observe({ ...changed })
  await tick()
  expect(invalidation).toHaveBeenCalledTimes(1)
  expect(fixture.ipc.getExtraInfo).toHaveBeenCalledTimes(1)
  const newer = { ...changed, title: 'Synthetic Peak' }
  fixture.setLibraryGame(newer)
  reconciliation.observe(newer)
  await tick()
  await tick()
  await tick()
  await tick()
  await jest.advanceTimersByTimeAsync(4000)
  expect(invalidation).toHaveBeenCalledTimes(2)
  expect(fixture.ipc.getExtraInfo).toHaveBeenCalledTimes(2)
})
