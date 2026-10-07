import {
  createAccountAchievements,
  createAchievementAccountContext
} from '../gameDetails/accountAchievements'
import { createRequestBarrier } from '../gameDetails/requestBarrier'
import type { GameAchievement } from 'common/types'
const a = [
  { achievement_id: 'fabricated-A', date_unlocked: 'fabricated-date-A' }
] as GameAchievement[]
const b = [
  { achievement_id: 'fabricated-B', date_unlocked: null }
] as GameAchievement[]
function setup() {
  let userDataId = 'synthetic-A'
  let user_id = 'synthetic-A'
  const getAccountId = () => userDataId || undefined
  const accountContext = createAchievementAccountContext(getAccountId)
  const cache = new Map<string, GameAchievement[]>([['shared-game', a]])
  const clear = jest.fn((appName: string) => {
    cache.delete(appName)
  })
  const credentials = jest.fn(() => Promise.resolve({ user_id }))
  const network = jest.fn(() =>
    Promise.resolve(user_id === 'synthetic-A' ? a : b)
  )
  const original = jest.fn(async (_event: unknown, appName: string) => {
    await accountContext.credentials(credentials)
    const cached = cache.get(appName)
    if (cached) return cached
    await accountContext.credentials(credentials)
    const result = await network()
    cache.set(appName, result)
    return result
  })
  const getAchievementsForAccount = createAccountAchievements(
    getAccountId,
    accountContext,
    clear,
    original,
    createRequestBarrier()
  )
  return {
    getAccountId,
    accountContext,
    cache,
    clear,
    credentials,
    network,
    getAchievementsForAccount,
    changeAccount: (nextUserDataId: string, nextUser_id = nextUserDataId) => {
      userDataId = nextUserDataId
      user_id = nextUser_id
      accountContext.observeAccount()
    }
  }
}

test('first bound request clears unscoped backing data and concurrent requests serialize with same-account reuse', async () => {
  const t = setup()
  const first = t.getAchievementsForAccount(
    {},
    'shared-game',
    'gog',
    'synthetic-A'
  )
  const second = t.getAchievementsForAccount(
    {},
    'shared-game',
    'gog',
    'synthetic-A'
  )
  expect(await first).toBe(a)
  expect(await second).toBe(a)
  expect(t.clear).toHaveBeenCalledTimes(1)
  expect(t.network).toHaveBeenCalledTimes(1)
})

test('credentials-B/userData-A transition is rejected before achievement network work', async () => {
  const t = setup()
  t.changeAccount('synthetic-A', 'synthetic-B')
  await expect(
    t.getAchievementsForAccount({}, 'shared-game', 'gog', 'synthetic-A')
  ).rejects.toThrow('credentials changed')
  expect(t.credentials).toHaveBeenCalledTimes(1)
  expect(t.network).not.toHaveBeenCalled()
})

test('actual inner credential selection cannot use a different account', async () => {
  const t = setup()
  t.credentials
    .mockResolvedValueOnce({ user_id: 'synthetic-A' })
    .mockResolvedValueOnce({ user_id: 'synthetic-B' })
  await expect(
    t.getAchievementsForAccount({}, 'shared-game', 'gog', 'synthetic-A')
  ).rejects.toThrow('credentials changed')
  expect(t.network).not.toHaveBeenCalled()
  expect(t.cache.has('shared-game')).toBe(false)
})

test('already-bound backing cache is fenced when credentials change before user data', async () => {
  const t = setup()
  expect(
    await t.getAchievementsForAccount({}, 'shared-game', 'gog', 'synthetic-A')
  ).toBe(a)
  t.changeAccount('synthetic-A', 'synthetic-B')
  await expect(
    t.getAchievementsForAccount({}, 'shared-game', 'gog', 'synthetic-A')
  ).rejects.toThrow('credentials changed')
  expect(t.network).toHaveBeenCalledTimes(1)
  expect(t.cache.has('shared-game')).toBe(false)
})

test('account ABA during original request rejects and removes its late cache write', async () => {
  const t = setup()
  let finish!: (value: GameAchievement[]) => void
  let started!: () => void
  const networkStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  t.network.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
        started()
      })
  )
  const old = t
    .getAchievementsForAccount({}, 'shared-game', 'gog', 'synthetic-A')
    .catch((error: unknown) => error)
  await networkStarted
  t.changeAccount('synthetic-B')
  t.changeAccount('synthetic-A')
  finish(a)
  expect(await old).toBeInstanceOf(Error)
  expect(t.cache.has('shared-game')).toBe(false)
  expect(
    await t.getAchievementsForAccount({}, 'shared-game', 'gog', 'synthetic-A')
  ).toBe(a)
  expect(t.network).toHaveBeenCalledTimes(2)
})

test('legacy A request pending then bound B waits for late A cache write and clears it before B lookup', async () => {
  const t = setup()
  let finish!: (value: GameAchievement[]) => void
  let started!: () => void
  const networkStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  t.network.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
        started()
      })
  )
  const legacy = t
    .getAchievementsForAccount({}, 'shared-game', 'gog', t.getAccountId()!)
    .catch((error: unknown) => error)
  await networkStarted
  t.changeAccount('synthetic-B')
  const bound = t.getAchievementsForAccount(
    {},
    'shared-game',
    'gog',
    'synthetic-B'
  )
  await Promise.resolve()
  await Promise.resolve()
  expect(t.network).toHaveBeenCalledTimes(1)
  finish(a)
  expect(await legacy).toBeInstanceOf(Error)
  expect(await bound).toBe(b)
  expect(t.cache.get('shared-game')).toBe(b)
  expect(t.network).toHaveBeenCalledTimes(2)
})
