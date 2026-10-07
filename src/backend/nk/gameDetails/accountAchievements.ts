// nk: #5 - achievement credentials and cache ownership share one account lease.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { GameAchievement, Runner } from 'common/types'
import { createRequestBarrier } from './requestBarrier'

export function createAchievementAccountContext(
  getAccountId: () => string | undefined
) {
  let accountId = getAccountId()
  let generation = 0
  const context = new AsyncLocalStorage<{
    accountId: string
    generation: number
  }>()
  function observeAccount() {
    const current = getAccountId()
    if (current !== accountId) {
      accountId = current
      generation++
    }
  }
  function current(expectedAccountId: string, expectedGeneration: number) {
    observeAccount()
    return accountId === expectedAccountId && generation === expectedGeneration
  }
  return {
    observeAccount,
    generation: () => {
      observeAccount()
      return generation
    },
    current,
    runForAccount: <T>(
      accountId: string,
      generation: number,
      work: () => Promise<T>
    ) => context.run({ accountId, generation }, work),
    async credentials<T extends { user_id: string }>(
      work: () => Promise<T | undefined>
    ) {
      const lease = context.getStore()
      if (lease && !current(lease.accountId, lease.generation))
        throw new Error('Achievement account changed')
      const credentials = await work()
      if (
        lease &&
        (!current(lease.accountId, lease.generation) ||
          credentials?.user_id !== lease.accountId)
      )
        throw new Error('Achievement credentials changed')
      return credentials
    }
  }
}

export function createAccountAchievements(
  getAccountId: () => string | undefined,
  accountContext: ReturnType<typeof createAchievementAccountContext>,
  clear: (appName: string) => void,
  getAchievements: (
    event: unknown,
    appName: string,
    runner: Runner,
    lang?: string
  ) => Promise<GameAchievement[]>,
  barrier: ReturnType<typeof createRequestBarrier>
) {
  const accounts = new Map<string, { accountId: string; generation: number }>()
  const pending = new Map<string, Promise<unknown>>()
  return (
    event: unknown,
    appName: string,
    runner: Runner,
    accountId: string,
    lang?: string
  ): Promise<GameAchievement[]> => {
    const generation = accountContext.generation()
    if (runner !== 'gog' || !accountId || getAccountId() !== accountId)
      return Promise.reject(new Error('Achievement account unavailable'))
    const work = (pending.get(appName) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() =>
        barrier.invalidate(`gog:${appName}`, async () => {
          if (!accountContext.current(accountId, generation))
            throw new Error('Achievement account changed')
          const bound = accounts.get(appName)
          if (
            bound?.accountId !== accountId ||
            bound.generation !== generation
          ) {
            clear(appName)
            accounts.delete(appName)
          }
          try {
            const achievements = await accountContext.runForAccount(
              accountId,
              generation,
              () => getAchievements(event, appName, runner, lang)
            )
            if (!accountContext.current(accountId, generation))
              throw new Error('Achievement account changed')
            accounts.set(appName, { accountId, generation })
            return achievements
          } catch (error) {
            clear(appName)
            accounts.delete(appName)
            throw error
          }
        })
      )
    pending.set(appName, work)
    void work.then(
      () => {
        if (pending.get(appName) === work) pending.delete(appName)
      },
      () => {
        if (pending.get(appName) === work) pending.delete(appName)
      }
    )
    return work
  }
}
