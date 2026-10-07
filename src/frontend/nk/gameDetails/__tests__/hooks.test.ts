import { getAccountId } from '../account'
jest.mock('../account', () => ({ getAccountId: jest.fn(() => undefined) }))
import type { GameInfo, WikiInfo } from 'common/types'
import { createHookRoot } from 'frontend/nk/test/hookRuntime'
import { gameDetailsApi, gameDetailsStore } from '../instance'
import {
  useExtraInfoState,
  useKnownFixes,
  useWikiInfoState,
  useAchievementsState
} from '../hooks'
import { useRouteGameInfo } from '../route'
import i18next from 'i18next'
import { useParams, useLocation } from 'react-router-dom'

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('frontend/nk/test/hookRuntime')>(
    'frontend/nk/test/hookRuntime'
  ).react,
  useDebugValue: () => undefined
}))
jest.mock('react-router-dom', () => ({
  useParams: jest.fn(() => ({ runner: 'legendary', appName: 'game-a' })),
  useLocation: jest.fn(() => ({ state: null }))
}))
jest.mock('frontend/hooks/constants', () => ({ getStatusLabel: () => '' }))
jest.mock('i18next', () => ({ __esModule: true, default: { language: 'en' } }))
jest.mock('../instance', () => {
  const { createGameDetailsStore } =
    jest.requireActual<typeof import('../store')>('../store')
  const { MemoryPersistence } =
    jest.requireActual<typeof import('../persistence')>('../persistence')
  return {
    gameDetailsStore: createGameDetailsStore(new MemoryPersistence(), {
      scheduleNotify: () => undefined
    }),
    gameDetailsApi: {
      getKnownFixes: jest.fn(() => Promise.resolve(null)),
      getExtraInfo: jest.fn(() => Promise.resolve(null))
    }
  }
})

const wiki = { howlongtobeat: { mainStory: 1 } } as WikiInfo
const gameInfo = {
  app_name: 'game-a',
  runner: 'legendary',
  extra: { about: { description: 'fallback' } }
} as GameInfo

beforeEach(async () => {
  await gameDetailsStore.clearAll()
  jest.clearAllMocks()
  jest.mocked(gameDetailsApi.getKnownFixes).mockResolvedValue(null)
  jest.mocked(gameDetailsApi.getExtraInfo).mockResolvedValue(null)
  i18next.language = 'en'
})

afterEach(async () => {
  await gameDetailsStore.flush()
})

test('first render uses stored wiki and later writes update the same mounted hook', async () => {
  gameDetailsStore.setSlot('legendary:game-a', 'wikiInfo', wiki)
  const view = createHookRoot(() => useWikiInfoState('legendary', 'game-a'))
  view.render({})
  expect(view.result.current[0]).toBe(wiki)
  const refreshed = { ...wiki, howlongtobeat: { mainStory: 2 } } as WikiInfo
  gameDetailsStore.setSlot('legendary:game-a', 'wikiInfo', refreshed)
  gameDetailsStore.notify()
  await view.settle()
  expect(view.result.current[0]).toBe(refreshed)
  view.unmount()
})

test('changing language selects its stored variant before committing stale-language data', () => {
  const en = { about: { description: 'English' } }
  const de = { about: { description: 'German' } }
  gameDetailsStore.setSlot('legendary:game-a', 'extraInfo@en', en)
  gameDetailsStore.setSlot('legendary:game-a', 'extraInfo@de', de)
  const view = createHookRoot(() => useExtraInfoState(gameInfo))
  view.render({})
  expect(view.result.current[0]).toBe(en)
  i18next.language = 'de'
  view.render({})
  expect(view.result.current[0]).toBe(de)
  view.unmount()
})

test('a known-fixes entry never starts a render and request loop', async () => {
  gameDetailsStore.setSlot('legendary:game-a', 'knownFixes', {
    title: 'Synthetic fix'
  })
  const view = createHookRoot(() => useKnownFixes('game-a', 'legendary'))
  view.render({})
  await view.settle()
  view.render({})
  await view.settle()
  expect(gameDetailsApi.getKnownFixes).toHaveBeenCalledTimes(1)
  view.unmount()
})

test('language changes request the missing variant and an obsolete setter cannot change the selected language', async () => {
  const english = { about: { description: 'English' } }
  const german = { about: { description: 'German' } }
  gameDetailsStore.setSlot('legendary:game-a', 'extraInfo@en', english)
  const view = createHookRoot(() => useExtraInfoState(gameInfo))
  view.render({})
  const obsoleteSetter = view.result.current[1]
  i18next.language = 'de'
  view.render({})
  expect(gameDetailsApi.getExtraInfo).toHaveBeenCalledTimes(2)
  expect(view.result.current[0]).toBe(gameInfo.extra)
  obsoleteSetter(english as never)
  gameDetailsStore.setSlot('legendary:game-a', 'extraInfo@de', german)
  gameDetailsStore.notify()
  await view.settle()
  expect(view.result.current[0]).toBe(german)
  obsoleteSetter(english as never)
  view.render({})
  expect(view.result.current[0]).toBe(german)
  view.unmount()
})

test('direct route without state resolves its exact persisted game identity', () => {
  jest
    .mocked(useParams)
    .mockReturnValue({ runner: 'legendary', appName: 'game-a' })
  jest.mocked(useLocation).mockReturnValue({ state: null } as never)
  gameDetailsStore.patchEntry('legendary:game-a', (entry) => ({
    ...entry,
    gameInfo
  }))
  const view = createHookRoot(() => useRouteGameInfo())
  view.render({})
  expect(view.result.current).toBe(gameInfo)
  view.unmount()
})

test('a delayed older-language request only fills its own slot after a newer language is shown', async () => {
  let release!: () => void
  const older = new Promise<void>((resolve) => {
    release = resolve
  })
  const english = { about: { description: 'English' } }
  const german = { about: { description: 'German' } }
  jest.mocked(gameDetailsApi.getExtraInfo).mockImplementationOnce(() =>
    older.then(() => {
      gameDetailsStore.setSlot('legendary:game-a', 'extraInfo@en', english)
      gameDetailsStore.notify()
      return english as never
    })
  )
  const view = createHookRoot(() => useExtraInfoState(gameInfo))
  view.render({})
  i18next.language = 'de'
  jest.mocked(gameDetailsApi.getExtraInfo).mockImplementationOnce(() => {
    gameDetailsStore.setSlot('legendary:game-a', 'extraInfo@de', german)
    gameDetailsStore.notify()
    return Promise.resolve(german as never)
  })
  view.render({})
  await view.settle()
  expect(view.result.current[0]).toBe(german)
  release()
  await older
  await view.settle()
  expect(view.result.current[0]).toBe(german)
  expect(
    gameDetailsStore.getSlot('legendary:game-a', 'extraInfo@en')?.data
  ).toBe(english)
  view.unmount()
})

test('achievement hook clears retained personal state on account switch, unknown identity and logout and fences stale setters', async () => {
  jest.mocked(getAccountId).mockReturnValue('synthetic-A')
  const old = [
    { achievement_id: 'fabricated', date_unlocked: 'fabricated-date' }
  ]
  gameDetailsStore.setSlot(
    'gog:shared-game',
    'achievements',
    old,
    'synthetic-A'
  )
  const view = createHookRoot(() => useAchievementsState('gog', 'shared-game'))
  view.render({})
  expect(view.result.current[0]).toBe(old)
  const oldSetter = view.result.current[1]
  jest.mocked(getAccountId).mockReturnValue('synthetic-B')
  view.render({})
  expect(view.result.current[0]).toEqual([])
  oldSetter(old as never)
  await view.settle()
  expect(view.result.current[0]).toEqual([])
  const current = [{ achievement_id: 'fabricated-B', date_unlocked: null }]
  gameDetailsStore.setSlot(
    'gog:shared-game',
    'achievements',
    current,
    'synthetic-B'
  )
  gameDetailsStore.notify()
  await view.settle()
  expect(view.result.current[0]).toBe(current)
  jest.mocked(getAccountId).mockReturnValue(undefined)
  view.render({})
  expect(view.result.current[0]).toEqual([])
  view.unmount()
})
