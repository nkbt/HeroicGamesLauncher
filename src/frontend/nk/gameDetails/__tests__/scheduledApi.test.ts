import type { ExtraInfo } from 'common/types'
import { phase2Fixture, tick } from './phase2Fixtures'
test('filled API reads remain immediate during play, and foreground joins paused missing work', async () => {
  const { store, scheduler, ipc, gameDetailsApi } = phase2Fixture()
  const data = { value: 'synthetic' }
  store.setSlot('legendary:filled', 'launchOptions', data)
  scheduler.update({ playing: true })
  expect(await gameDetailsApi.getLaunchOptions('filled', 'legendary')).toBe(
    data
  )
  const background = gameDetailsApi.getExtraInfo('game-a', 'legendary', {
    priority: 2
  })
  const foreground = gameDetailsApi.getExtraInfo('game-a', 'legendary')
  await tick()
  expect(ipc.getExtraInfo).not.toHaveBeenCalled()
  scheduler.update({ playing: false })
  expect(await background).toBe(await foreground)
  expect(ipc.getExtraInfo).toHaveBeenCalledTimes(1)
})
test('a language change fences delayed and queued old-language completions', async () => {
  const { scheduler, ipc, gameDetailsApi, store, setLanguage } = phase2Fixture()
  let resolve!: (value: ExtraInfo) => void
  jest.mocked(ipc.getExtraInfo).mockImplementationOnce(
    () =>
      new Promise((yes) => {
        resolve = yes
      })
  )
  const old = gameDetailsApi.getExtraInfo('game-a', 'legendary')
  await tick()
  setLanguage('fr')
  resolve({
    storeUrl: 'https://store.example/old',
    about: { description: 'old' }
  } as ExtraInfo)
  await old
  expect(store.getSlot('legendary:game-a', 'extraInfo@en')).toBeUndefined()
  scheduler.update({ playing: true })
  const queued = gameDetailsApi.getExtraInfo('game-a', 'legendary', {
    priority: 2
  })
  await tick()
  setLanguage('de')
  scheduler.update({ playing: false })
  await expect(queued).rejects.toMatchObject({
    name: 'DetailsRequestCancelled'
  })
  expect(ipc.getExtraInfo).toHaveBeenCalledTimes(1)
  expect(store.getSlot('legendary:game-a', 'extraInfo@fr')).toBeUndefined()
})
test('refresh cancels queued speculative work before its barrier and preserves another game', async () => {
  const { scheduler, gameDetailsApi, ipc, store } = phase2Fixture()
  scheduler.update({ playing: true })
  const old = gameDetailsApi
    .getExtraInfo('game-a', 'legendary', { priority: 2 })
    .catch(() => null)
  const other = gameDetailsApi.getKnownFixes('game-b', 'gog', { priority: 2 })
  await tick()
  const current = gameDetailsApi.beginRefresh('legendary', 'game-a')
  scheduler.update({ playing: false })
  await old
  await other
  expect(current()).toBe(true)
  expect(ipc.getExtraInfo).not.toHaveBeenCalled()
  expect(store.getSlot('gog:game-b', 'knownFixes')).toBeDefined()
})

test('foreground intent survives a pre-enqueue hold and disabled prefetch', async () => {
  const fixture = phase2Fixture()
  let release!: () => void
  fixture.gameDetailsApi.holdFetches(
    'legendary',
    'game-a',
    new Promise<void>((resolve) => {
      release = resolve
    })
  )
  const background = fixture.gameDetailsApi.getExtraInfo(
    'game-a',
    'legendary',
    { priority: 2 }
  )
  const foreground = fixture.gameDetailsApi.getExtraInfo('game-a', 'legendary')
  fixture.scheduler.update({ enabled: false })
  release()
  expect(await foreground).toBe(await background)
  expect(fixture.ipc.getExtraInfo).toHaveBeenCalledTimes(1)
})

test('queued slow install promotion changes transport and bypasses unrelated local idleness', async () => {
  const fixture = phase2Fixture()
  fixture.scheduler.update({ online: false })
  let release!: () => void
  const local = fixture.scheduler.enqueue(
    { id: 'local', key: 'other', lane: 'local', network: false, priority: 0 },
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const background = fixture.gameDetailsApi.getInstallInfo(
    'game-a',
    'legendary',
    'Windows',
    undefined,
    undefined,
    { priority: 2, installInfoBackground: true }
  )
  await tick()
  const foreground = fixture.gameDetailsApi.getInstallInfo(
    'game-a',
    'legendary',
    'Windows'
  )
  fixture.scheduler.update({ online: true, enabled: false })
  expect(await foreground).toBe(await background)
  expect(fixture.getInstallInfo).toHaveBeenCalledTimes(1)
  expect(fixture.getInstallInfoBackground).not.toHaveBeenCalled()
  release()
  await local
})

test('a dispatched slow install remains shared after a foreground join', async () => {
  const fixture = phase2Fixture()
  let release!: (
    value: Awaited<ReturnType<typeof fixture.getInstallInfoBackground>>
  ) => void
  fixture.getInstallInfoBackground.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  const background = fixture.gameDetailsApi.getInstallInfo(
    'game-a',
    'legendary',
    'Windows',
    undefined,
    undefined,
    { priority: 2, installInfoBackground: true }
  )
  await tick()
  const foreground = fixture.gameDetailsApi.getInstallInfo(
    'game-a',
    'legendary',
    'Windows'
  )
  release({ manifest: { disk_size: 9, download_size: 4 } } as never)
  expect(await foreground).toBe(await background)
  expect(fixture.getInstallInfoBackground).toHaveBeenCalledTimes(1)
  expect(fixture.getInstallInfo).not.toHaveBeenCalled()
})

test('hover then background ownership survives leave through API wiki deduplication', async () => {
  const fixture = phase2Fixture()
  fixture.scheduler.update({ playing: true })
  const hover = fixture.gameDetailsApi.getWikiGameInfo(
    gameTitle,
    'game-a',
    'legendary',
    { priority: 1 }
  )
  const background = fixture.gameDetailsApi.getWikiGameInfo(
    gameTitle,
    'game-a',
    'legendary',
    { priority: 2 }
  )
  await tick()
  fixture.scheduler.cancel('legendary:game-a', true)
  fixture.scheduler.update({ playing: false })
  expect(await hover).toBe(await background)
  expect(fixture.ipc.getWikiGameInfo).toHaveBeenCalledTimes(1)
})
const gameTitle = 'Synthetic Harbor'

test('background then hover owner survives pre-enqueue leave', async () => {
  const fixture = phase2Fixture()
  let release!: () => void
  fixture.gameDetailsApi.holdFetches(
    'legendary',
    'game-a',
    new Promise<void>((resolve) => {
      release = resolve
    })
  )
  const background = fixture.gameDetailsApi.getWikiGameInfo(
    gameTitle,
    'game-a',
    'legendary',
    { priority: 2 }
  )
  const hover = fixture.gameDetailsApi.getWikiGameInfo(
    gameTitle,
    'game-a',
    'legendary',
    { priority: 1 }
  )
  fixture.scheduler.cancel('legendary:game-a', true)
  release()
  expect(await background).toBe(await hover)
  expect(fixture.ipc.getWikiGameInfo).toHaveBeenCalledTimes(1)
})

async function restoreSlowOwners(
  backgroundFirst: boolean,
  eviction: boolean,
  pageOwner = false
) {
  const fixture = phase2Fixture()
  fixture.scheduler.update({ online: false })
  let release!: () => void
  const local = fixture.scheduler.enqueue(
    {
      id: 'local-owner',
      key: 'other',
      lane: 'local',
      network: false,
      priority: 0
    },
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const backgroundOptions = {
    priority: 2 as const,
    installInfoBackground: true
  }
  const first = fixture.gameDetailsApi.getInstallInfo(
    'game-a',
    'legendary',
    'Windows',
    undefined,
    undefined,
    backgroundFirst ? backgroundOptions : { priority: 1 }
  )
  await tick()
  const second = fixture.gameDetailsApi.getInstallInfo(
    'game-a',
    'legendary',
    'Windows',
    undefined,
    undefined,
    backgroundFirst ? { priority: 1 } : backgroundOptions
  )
  const page = pageOwner
    ? fixture.gameDetailsApi.getInstallInfo('game-a', 'legendary', 'Windows')
    : undefined
  if (eviction) fixture.scheduler.downgrade('legendary:game-a')
  else fixture.scheduler.cancel('legendary:game-a', true)
  fixture.scheduler.update({ online: true })
  await tick()
  if (pageOwner) {
    expect(await page).toBe(await first)
    expect(fixture.getInstallInfo).toHaveBeenCalledTimes(1)
    expect(fixture.getInstallInfoBackground).not.toHaveBeenCalled()
  } else {
    expect(fixture.getInstallInfo).not.toHaveBeenCalled()
    expect(fixture.getInstallInfoBackground).not.toHaveBeenCalled()
  }
  release()
  await local
  expect(await first).toBe(await second)
  if (!pageOwner) {
    expect(fixture.getInstallInfoBackground).toHaveBeenCalledTimes(1)
    expect(fixture.getInstallInfo).not.toHaveBeenCalled()
  }
  fixture.scheduler.dispose()
}
test('background-first slow install restores slow lane after hover leave', async () => {
  await restoreSlowOwners(true, false)
})
test('hover-first slow install restores joined background lane after leave', async () => {
  await restoreSlowOwners(false, false)
})
test('background-first latest-three eviction restores slow install lane', async () => {
  await restoreSlowOwners(true, true)
})
test('hover-first latest-three eviction restores joined slow install lane', async () => {
  await restoreSlowOwners(false, true)
})
test('page owner keeps normal install behavior through hover leave', async () => {
  await restoreSlowOwners(true, false, true)
})
test('page owner keeps normal install behavior through intent eviction', async () => {
  await restoreSlowOwners(false, true, true)
})

test('ordinary background install remains normal CLI work after hover leave', async () => {
  const fixture = phase2Fixture()
  fixture.scheduler.update({ online: false })
  let release!: () => void
  const local = fixture.scheduler.enqueue(
    {
      id: 'normal-local',
      key: 'other',
      lane: 'local',
      network: false,
      priority: 0
    },
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const background = fixture.gameDetailsApi.getInstallInfo(
    'game-a',
    'legendary',
    'Windows',
    undefined,
    undefined,
    { priority: 2 }
  )
  await tick()
  const hover = fixture.gameDetailsApi.getInstallInfo(
    'game-a',
    'legendary',
    'Windows',
    undefined,
    undefined,
    { priority: 1 }
  )
  fixture.scheduler.cancel('legendary:game-a', true)
  fixture.scheduler.update({ online: true })
  expect(await background).toBe(await hover)
  expect(fixture.getInstallInfo).toHaveBeenCalledTimes(1)
  expect(fixture.getInstallInfoBackground).not.toHaveBeenCalled()
  release()
  await local
})

test('fresh page ownership retires a cancelled held CLI request before the hold settles', async () => {
  const fixture = phase2Fixture()
  let finish!: (value: import('common/types').LaunchOption[]) => void
  jest.mocked(fixture.ipc.getLaunchOptions).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  let release!: () => void
  fixture.gameDetailsApi.holdFetches(
    'legendary',
    'game-a',
    new Promise<void>((resolve) => {
      release = resolve
    })
  )
  const old = fixture.gameDetailsApi
    .getLaunchOptions('game-a', 'legendary', { priority: 1 })
    .catch((error: unknown) => error)
  fixture.scheduler.cancel('legendary:game-a', true)
  const page = fixture.gameDetailsApi.getLaunchOptions('game-a', 'legendary')
  fixture.scheduler.update({ enabled: false })
  release()
  expect(await old).toMatchObject({ name: 'DetailsRequestCancelled' })
  await tick()
  const joinedPage = fixture.gameDetailsApi.getLaunchOptions(
    'game-a',
    'legendary'
  )
  await tick()
  expect(fixture.ipc.getLaunchOptions).toHaveBeenCalledTimes(1)
  finish([])
  expect(await joinedPage).toBe(await page)
  expect(fixture.ipc.getLaunchOptions).toHaveBeenCalledTimes(1)
  expect(
    fixture.store.getSlot('legendary:game-a', 'launchOptions')
  ).toBeDefined()
  expect(
    await fixture.gameDetailsApi.getLaunchOptions('game-a', 'legendary')
  ).toEqual([])
  expect(fixture.ipc.getLaunchOptions).toHaveBeenCalledTimes(1)
})

test('fresh page request immediately replaces a cancelled queued CLI request while prefetch is disabled', async () => {
  const fixture = phase2Fixture()
  fixture.scheduler.update({ playing: true })
  const old = fixture.gameDetailsApi
    .getLaunchOptions('game-a', 'legendary', { priority: 1 })
    .catch((error: unknown) => error)
  await tick()
  fixture.scheduler.cancel('legendary:game-a', true)
  const page = fixture.gameDetailsApi.getLaunchOptions('game-a', 'legendary')
  fixture.scheduler.update({ enabled: false, playing: false })
  expect(await old).toMatchObject({ name: 'DetailsRequestCancelled' })
  expect(await page).toEqual([])
  expect(fixture.ipc.getLaunchOptions).toHaveBeenCalledTimes(1)
  expect(
    fixture.store.getSlot('legendary:game-a', 'launchOptions')
  ).toBeDefined()
})

test('wiki wrapper retires cancelled held ownership and preserves the replacement through old cleanup', async () => {
  const fixture = phase2Fixture()
  let release!: () => void
  fixture.gameDetailsApi.holdFetches(
    'legendary',
    'game-a',
    new Promise<void>((resolve) => {
      release = resolve
    })
  )
  const old = fixture.gameDetailsApi
    .getWikiGameInfo(gameTitle, 'game-a', 'legendary', { priority: 1 })
    .catch((error: unknown) => error)
  fixture.scheduler.cancel('legendary:game-a', true)
  const page = fixture.gameDetailsApi.getWikiGameInfo(
    gameTitle,
    'game-a',
    'legendary'
  )
  fixture.scheduler.update({ enabled: false })
  release()
  expect(await old).toMatchObject({ name: 'DetailsRequestCancelled' })
  expect(await page).toEqual({ pcgamingwiki: { steamID: '123' } })
  expect(fixture.ipc.getWikiGameInfo).toHaveBeenCalledTimes(1)
  expect(fixture.store.getSlot('legendary:game-a', 'wikiInfo')).toBeDefined()
})

test('hover leave and eviction do not change already-dispatched slow transport', async () => {
  const fixture = phase2Fixture()
  let finish!: (
    value: Awaited<ReturnType<typeof fixture.getInstallInfoBackground>>
  ) => void
  fixture.getInstallInfoBackground.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const background = fixture.gameDetailsApi.getInstallInfo(
    'game-a',
    'legendary',
    'Windows',
    undefined,
    undefined,
    { priority: 2, installInfoBackground: true }
  )
  await tick()
  const hover = fixture.gameDetailsApi.getInstallInfo(
    'game-a',
    'legendary',
    'Windows',
    undefined,
    undefined,
    { priority: 1 }
  )
  fixture.scheduler.cancel('legendary:game-a', true)
  fixture.scheduler.downgrade('legendary:game-a')
  finish({ manifest: { disk_size: 8, download_size: 4 } } as never)
  expect(await background).toBe(await hover)
  expect(fixture.getInstallInfoBackground).toHaveBeenCalledTimes(1)
  expect(fixture.getInstallInfo).not.toHaveBeenCalled()
})
