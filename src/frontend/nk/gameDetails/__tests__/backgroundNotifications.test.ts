import { createGameDetailsStore } from '../store'
import { MemoryPersistence } from '../persistence'
test('many background completions commit at most four times per second and preserve identity', () => {
  jest.useFakeTimers()
  jest.setSystemTime(0)
  const store = createGameDetailsStore(new MemoryPersistence())
  const commits: number[] = []
  store.state.subscribe(() => commits.push(Date.now()))
  const data = { value: 1 }
  const games = Array.from({ length: 100 }, (_, index) => `gog:game-${index}`)
  for (const key of games) {
    store.batchUpdates(() => store.setSlot(key, 'wikiInfo', data), true)
    jest.advanceTimersByTime(10)
  }
  expect(commits.filter((time) => time < 1000)).toHaveLength(4)
  expect(store.getSlot(games[0], 'wikiInfo')?.data).toBe(data)
  store.setSlot('gog:foreground', 'wikiInfo', data)
  jest.advanceTimersByTime(0)
  expect(
    store.state.getState().entries['gog:foreground'].slots.wikiInfo?.data
  ).toBe(data)
  jest.useRealTimers()
})
