import { createDetailsPrefetch } from '../prefetch'
import type { GameInfo, GameAchievement } from 'common/types'
import { createGameDetailsApi, type DetailsIpc } from '../api'
import { MemoryPersistence } from '../persistence'
import { createGameDetailsStore } from '../store'

const unlocked = [
  { achievement_id: 'fabricated', date_unlocked: 'fabricated-date' }
] as GameAchievement[]
function setup(
  persistence = new MemoryPersistence(),
  initialAccountId: string | null = 'synthetic-A'
) {
  let accountId: string | undefined = initialAccountId ?? undefined
  const store = createGameDetailsStore(persistence, {
    scheduleNotify: () => undefined
  })
  const getAchievementsForAccount = jest.fn(() => Promise.resolve(unlocked))
  const ipc = { getAchievementsForAccount } as unknown as DetailsIpc
  const gameDetailsApi = createGameDetailsApi(store, {
    ipc: () => ipc,
    getInstallInfo: () => Promise.resolve(null),
    getAccountId: () => accountId,
    getLanguage: () => 'en',
    isOnline: () => true,
    getLibraryGame: () => undefined,
    platform: 'linux'
  })
  return {
    store,
    gameDetailsApi,
    getAchievementsForAccount,
    setAccountId: (value: string | undefined) => {
      accountId = value
    }
  }
}

test('recreated renderer rejects another account cached achievements while retaining neutral details', async () => {
  const persistence = new MemoryPersistence()
  const a = setup(persistence)
  await a.store.hydrate()
  await a.gameDetailsApi.getAchievements('shared-game', 'gog')
  const neutral = { title: 'Synthetic shared game' }
  a.store.setSlot('gog:shared-game', 'extraInfo@en', neutral)
  await a.store.flush()
  const b = setup(persistence, 'synthetic-B')
  b.getAchievementsForAccount.mockResolvedValueOnce([])
  await b.store.hydrate()
  expect(await b.gameDetailsApi.getAchievements('shared-game', 'gog')).toEqual(
    []
  )
  expect(b.getAchievementsForAccount).toHaveBeenCalledWith(
    'shared-game',
    'gog',
    'synthetic-B',
    undefined
  )
  expect(b.store.getSlot('gog:shared-game', 'achievements')?.accountId).toBe(
    'synthetic-B'
  )
  expect(b.store.getSlot('gog:shared-game', 'extraInfo@en')?.data).toBe(neutral)
  await b.store.flush()
})

test('same account reuses bound persistence with zero achievement calls', async () => {
  const persistence = new MemoryPersistence()
  await persistence.putMany([
    [
      'gog:shared-game',
      { slots: { achievements: { data: unlocked, accountId: 'synthetic-A' } } }
    ]
  ])
  const t = setup(persistence)
  await t.store.hydrate()
  expect(await t.gameDetailsApi.getAchievements('shared-game', 'gog')).toBe(
    unlocked
  )
  expect(t.getAchievementsForAccount).not.toHaveBeenCalled()
})

test('unknown identity and logout never read personal persistence or start a request; unscoped values are untrusted', async () => {
  const persistence = new MemoryPersistence()
  await persistence.putMany([
    ['gog:shared-game', { slots: { achievements: { data: unlocked } } }]
  ])
  const t = setup(persistence, null)
  await t.store.hydrate()
  expect(await t.gameDetailsApi.getAchievements('shared-game', 'gog')).toEqual(
    []
  )
  expect(t.getAchievementsForAccount).not.toHaveBeenCalled()
  t.setAccountId('synthetic-A')
  await t.gameDetailsApi.getAchievements('shared-game', 'gog')
  expect(t.getAchievementsForAccount).toHaveBeenCalledTimes(1)
  t.setAccountId(undefined)
  expect(await t.gameDetailsApi.getAchievements('shared-game', 'gog')).toEqual(
    []
  )
  expect(t.getAchievementsForAccount).toHaveBeenCalledTimes(1)
  await t.store.flush()
})

test('account change before hydration completes never returns the old personal slot', async () => {
  const persistence = new MemoryPersistence()
  let finish!: (
    entries: Awaited<ReturnType<MemoryPersistence['loadAll']>>
  ) => void
  persistence.loadAll = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const t = setup(persistence)
  const hydration = t.store.hydrate()
  t.setAccountId('synthetic-B')
  finish({
    'gog:shared-game': {
      slots: { achievements: { data: unlocked, accountId: 'synthetic-A' } }
    }
  })
  await hydration
  t.getAchievementsForAccount.mockResolvedValueOnce([])
  expect(await t.gameDetailsApi.getAchievements('shared-game', 'gog')).toEqual(
    []
  )
  expect(t.getAchievementsForAccount).toHaveBeenCalledTimes(1)
  await t.store.flush()
})

test('old in-flight completion cannot return or store old account data after a switch', async () => {
  const t = setup()
  let finish!: (achievements: GameAchievement[]) => void
  t.getAchievementsForAccount.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const a = t.gameDetailsApi.getAchievements('shared-game', 'gog')
  await Promise.resolve()
  await Promise.resolve()
  t.setAccountId('synthetic-B')
  t.getAchievementsForAccount.mockResolvedValueOnce([])
  const b = t.gameDetailsApi.getAchievements('shared-game', 'gog')
  expect(await b).toEqual([])
  finish(unlocked)
  expect(await a).toEqual([])
  expect(t.store.getSlot('gog:shared-game', 'achievements')?.accountId).toBe(
    'synthetic-B'
  )
  expect(t.store.getSlot('gog:shared-game', 'achievements')?.data).toEqual([])
  await t.store.flush()
})

test('an old account failure cannot fall back to its cached personal values after logout', async () => {
  const t = setup()
  t.store.setSlot('gog:shared-game', 'achievements', unlocked, 'synthetic-A')
  let fail!: (error: Error) => void
  t.getAchievementsForAccount.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
      })
  )
  const old = t.gameDetailsApi.getAchievements(
    'shared-game',
    'gog',
    undefined,
    { force: true }
  )
  await Promise.resolve()
  await Promise.resolve()
  t.setAccountId(undefined)
  fail(new Error('fabricated failure'))
  expect(await old).toEqual([])
  expect(t.store.getSlot('gog:shared-game', 'achievements')?.accountId).toBe(
    'synthetic-A'
  )
  await t.store.flush()
})

test('missing-only prefetch attempts are bound to the account without disturbing neutral slots', async () => {
  const t = setup()
  t.store.setSlot('gog:shared-game', 'extraInfo@en', {})
  t.store.setSlot('gog:shared-game', 'wikiInfo', null)
  t.store.setSlot('gog:shared-game', 'knownFixes', null)
  t.store.setSlot('gog:shared-game', 'launchOptions', [])
  t.store.setSlot('gog:shared-game', 'installInfo@Windows', {})
  t.store.setSlot('settings:shared-game', 'settings', {})
  const prefetch = createDetailsPrefetch(
    t.gameDetailsApi,
    t.store,
    'linux',
    () => 'en'
  )
  const gameInfo = {
    runner: 'gog',
    app_name: 'shared-game',
    install: { platform: 'Windows' }
  } as GameInfo
  await prefetch.prefetch(gameInfo)
  t.setAccountId('synthetic-B')
  t.getAchievementsForAccount.mockResolvedValueOnce([])
  await prefetch.prefetch(gameInfo)
  expect(t.getAchievementsForAccount).toHaveBeenCalledTimes(2)
  expect(t.store.getSlot('gog:shared-game', 'achievements')?.accountId).toBe(
    'synthetic-B'
  )
  await t.store.flush()
})

test('even an immediate cached read is fenced before its asynchronous result reaches a changed account', async () => {
  const t = setup()
  t.store.setSlot('gog:shared-game', 'achievements', unlocked, 'synthetic-A')
  const read = t.gameDetailsApi.getAchievements('shared-game', 'gog')
  t.setAccountId('synthetic-B')
  expect(await read).toEqual([])
  expect(t.getAchievementsForAccount).not.toHaveBeenCalled()
  await t.store.flush()
})
