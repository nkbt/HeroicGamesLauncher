import { createDetailsPrefetch } from '../prefetch'
import { gameInfo, phase2Fixture, tick } from './phase2Fixtures'
function seedLocal(
  fixture: ReturnType<typeof phase2Fixture>,
  appName = 'game-a'
) {
  const key = `legendary:${appName}`
  fixture.store.setSlot(key, 'wikiInfo', null)
  fixture.store.setSlot(`settings:${appName}`, 'settings', {})
  fixture.store.setSlot(key, 'knownFixes', null)
  fixture.store.setSlot(key, 'anticheat', null)
  fixture.store.setSlot(key, 'launchOptions', [])
  fixture.store.setSlot(key, 'achievements', [])
}
test('failed startup attempts are retained through unchanged passes and explicit hover can retry', async () => {
  const fixture = phase2Fixture()
  seedLocal(fixture)
  fixture.store.setSlot('legendary:game-a', 'installInfo@Windows', {})
  jest
    .mocked(fixture.ipc.getExtraInfo)
    .mockRejectedValueOnce(new Error('synthetic failure'))
  const prefetch = createDetailsPrefetch(
    fixture.gameDetailsApi,
    fixture.store,
    'linux',
    fixture.language
  )
  await prefetch.prefetch(gameInfo)
  await prefetch.prefetch({ ...gameInfo })
  expect(fixture.ipc.getExtraInfo).toHaveBeenCalledTimes(1)
  expect(
    fixture.store.getSlot('legendary:game-a', 'extraInfo@en')
  ).toBeUndefined()
  await prefetch.prefetch(gameInfo, 1)
  expect(fixture.ipc.getExtraInfo).toHaveBeenCalledTimes(2)
  expect(
    fixture.store.getSlot('legendary:game-a', 'extraInfo@en')
  ).toBeDefined()
})
test('new language pass fills only that missing variant and preserves existing data', async () => {
  const fixture = phase2Fixture()
  const old = { storeUrl: 'https://store.example/en' }
  fixture.store.setSlot('legendary:game-a', 'extraInfo@en', old)
  fixture.setLanguage('fr')
  const prefetch = createDetailsPrefetch(
    fixture.gameDetailsApi,
    fixture.store,
    'linux',
    fixture.language
  )
  await prefetch.prefetch(gameInfo, 2, true)
  expect(fixture.store.getSlot('legendary:game-a', 'extraInfo@en')?.data).toBe(
    old
  )
  expect(
    fixture.store.getSlot('legendary:game-a', 'extraInfo@fr')
  ).toBeDefined()
  expect(fixture.ipc.getWikiGameInfo).not.toHaveBeenCalled()
  expect(fixture.ipc.requestGameSettings).not.toHaveBeenCalled()
  expect(fixture.getInstallInfo).not.toHaveBeenCalled()
})
test('slow progress counts fifty completed games with successes and failures separately', async () => {
  const fixture = phase2Fixture()
  const report = jest.fn()
  const prefetch = createDetailsPrefetch(
    fixture.gameDetailsApi,
    fixture.store,
    'linux',
    fixture.language,
    report
  )
  const games = Array.from({ length: 50 }, (_, index) => ({
    ...gameInfo,
    app_name: `game-${index}`
  }))
  for (const game of games) {
    seedLocal(fixture, game.app_name)
    fixture.store.setSlot(`legendary:${game.app_name}`, 'extraInfo@en', {})
  }
  fixture.getInstallInfoBackground.mockResolvedValueOnce(null as never)
  await Promise.all(games.map((game) => prefetch.prefetch(game)))
  expect(fixture.getInstallInfoBackground).toHaveBeenCalledTimes(50)
  expect(report).toHaveBeenCalledTimes(1)
  expect(report).toHaveBeenCalledWith(
    '[nk] game details install attempts: 50 completed, 49 successful, 1 failed'
  )
})

test('cancelling queued wiki recovers only its attempt and retains a settled extra-info failure', async () => {
  const fixture = phase2Fixture()
  seedLocal(fixture)
  fixture.store.dropSlots(['legendary:game-a'], (slot) => slot === 'wikiInfo')
  fixture.store.setSlot('legendary:game-a', 'installInfo@Windows', {})
  jest
    .mocked(fixture.ipc.getExtraInfo)
    .mockRejectedValueOnce(new Error('synthetic failure'))
  let release!: () => void
  const blocker = fixture.scheduler.enqueue(
    {
      id: 'wiki-blocker',
      key: 'other',
      lane: 'wiki',
      network: true,
      priority: 0
    },
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const prefetch = createDetailsPrefetch(
    fixture.gameDetailsApi,
    fixture.store,
    'linux',
    fixture.language
  )
  const pass = prefetch.prefetch(gameInfo)
  await tick()
  fixture.scheduler.cancel('legendary:game-a')
  await pass
  expect(fixture.ipc.getExtraInfo).toHaveBeenCalledTimes(1)
  release()
  await blocker
  const next = prefetch.prefetch(gameInfo)
  fixture.scheduler.update({ enabled: false })
  await tick()
  expect(fixture.ipc.getExtraInfo).toHaveBeenCalledTimes(1)
  fixture.scheduler.update({ enabled: true })
  await next
  expect(fixture.ipc.getExtraInfo).toHaveBeenCalledTimes(1)
  expect(fixture.ipc.getWikiGameInfo).toHaveBeenCalledTimes(1)
})

test('language-only cancellation can recover its undispatched variant', async () => {
  const fixture = phase2Fixture()
  fixture.scheduler.update({ playing: true })
  fixture.setLanguage('fr')
  const prefetch = createDetailsPrefetch(
    fixture.gameDetailsApi,
    fixture.store,
    'linux',
    fixture.language
  )
  const first = prefetch.prefetch(gameInfo, 2, true)
  await tick()
  fixture.gameDetailsApi.beginRefresh('legendary', 'game-a')
  await first
  fixture.scheduler.update({ playing: false })
  await prefetch.prefetch(gameInfo, 2, true)
  expect(fixture.ipc.getExtraInfo).toHaveBeenCalledTimes(1)
  expect(
    fixture.store.getSlot('legendary:game-a', 'extraInfo@fr')
  ).toBeDefined()
})

test('late cancellation cleanup cannot erase a newer failed owner for the same slot', async () => {
  const fixture = phase2Fixture()
  fixture.setLanguage('fr')
  fixture.scheduler.update({ playing: true })
  const prefetch = createDetailsPrefetch(
    fixture.gameDetailsApi,
    fixture.store,
    'linux',
    fixture.language
  )
  const old = prefetch.prefetch(gameInfo, 2, true)
  await tick()
  fixture.gameDetailsApi.beginRefresh('legendary', 'game-a')
  jest
    .mocked(fixture.ipc.getExtraInfo)
    .mockRejectedValueOnce(new Error('new synthetic failure'))
  const newer = prefetch.prefetch(gameInfo, 1, true)
  await old
  fixture.scheduler.update({ playing: false })
  await newer
  await prefetch.prefetch(gameInfo, 2, true)
  expect(fixture.ipc.getExtraInfo).toHaveBeenCalledTimes(1)
  expect(
    fixture.store.getSlot('legendary:game-a', 'extraInfo@fr')
  ).toBeUndefined()
})
