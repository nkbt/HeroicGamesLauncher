import { MemoryPersistence } from '../persistence'
import { createGameDetailsStore } from '../store'
import type { GameDetailsEntry } from '../types'

function setup(preloaded: Record<string, GameDetailsEntry> = {}) {
  const persistence = new MemoryPersistence()
  for (const [key, entry] of Object.entries(preloaded)) {
    persistence.data.set(key, entry)
  }
  const notifications: Array<() => void> = []
  const store = createGameDetailsStore(persistence, {
    flushDelayMs: 500,
    scheduleNotify: (notify) => notifications.push(notify),
    warn: jest.fn()
  })
  const runNotifications = () => {
    for (const notify of notifications.splice(0)) notify()
  }
  return { persistence, store, runNotifications }
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('setSlot stores the given object (identity kept) and a "none" marker', () => {
  const { store } = setup()
  const data = { a: 1 }
  store.setSlot('legendary:game-a', 'extraInfo@en', data)
  expect(store.getSlot('legendary:game-a', 'extraInfo@en')?.data).toBe(data)
  store.setSlot('legendary:game-a', 'anticheat', undefined)
  // a cached "none" is distinct from a missing slot; no timestamps
  expect(store.getSlot('legendary:game-a', 'anticheat')).toEqual({ data: null })
  expect(store.getSlot('legendary:game-a', 'knownFixes')).toBeUndefined()
})

test('reads see writes at once; subscribers get one batched notification', () => {
  const { store, runNotifications } = setup()
  const listener = jest.fn()
  store.state.subscribe(listener)
  store.setSlot('gog:1', 'wikiInfo', { w: 1 })
  store.setSlot('gog:1', 'achievements', [])
  store.setSlot('gog:2', 'knownFixes', null)
  expect(store.getSlot('gog:1', 'achievements')?.data).toEqual([])
  expect(listener).not.toHaveBeenCalled()
  runNotifications()
  expect(listener).toHaveBeenCalledTimes(1)
  expect(Object.keys(store.state.getState().entries).sort()).toEqual([
    'gog:1',
    'gog:2'
  ])
})

test('an unchanged entry keeps its object when another game is written', () => {
  const { store } = setup()
  store.setSlot('gog:1', 'wikiInfo', { w: 1 })
  const before = store.getEntry('gog:1')
  store.setSlot('gog:2', 'wikiInfo', { w: 2 })
  expect(store.getEntry('gog:1')).toBe(before)
})

test('nothing expires: a filled slot is unchanged years later', () => {
  const { store } = setup()
  store.setSlot('gog:1', 'wikiInfo', { w: 1 })
  const slot = store.getSlot('gog:1', 'wikiInfo')
  jest.setSystemTime(new Date('2040-01-01'))
  expect(store.getSlot('gog:1', 'wikiInfo')).toBe(slot)
})

test('write-behind: one putMany per flush window', async () => {
  const { persistence, store } = setup()
  store.setSlot('gog:1', 'extraInfo@en', { a: 1 })
  store.setSlot('gog:1', 'wikiInfo', { b: 2 })
  store.setSlot('gog:2', 'extraInfo@en', { c: 3 })
  expect(persistence.putCalls).toBe(0)
  jest.advanceTimersByTime(500)
  await store.flush()
  expect(persistence.putCalls).toBe(1)
  expect([...persistence.data.keys()].sort()).toEqual(['gog:1', 'gog:2'])
  expect(Object.keys(persistence.data.get('gog:1')!.slots)).toEqual([
    'extraInfo@en',
    'wikiInfo'
  ])
})

test('hydration merges under slots written in this session', async () => {
  const { store } = setup({
    'gog:1': {
      slots: { 'extraInfo@en': { data: 'old' }, wikiInfo: { data: 'w' } },
      listSig: { meta: 'm1', art: 'a1' }
    },
    'gog:2': { slots: { 'extraInfo@en': { data: 'x' } } }
  })
  store.setSlot('gog:1', 'extraInfo@en', 'new')
  store.patchEntry('gog:1', (entry) => ({
    ...entry,
    listSig: { ...entry.listSig, meta: 'm2' }
  }))
  await store.hydrate()
  expect(store.state.getState().hydrated).toBe(true)
  expect(store.getSlot('gog:1', 'extraInfo@en')?.data).toBe('new')
  expect(store.getSlot('gog:1', 'wikiInfo')?.data).toBe('w')
  expect(store.getEntry('gog:1')?.listSig).toEqual({ art: 'a1' })
  expect(store.getSlot('gog:2', 'extraInfo@en')?.data).toBe('x')
})

test('slots dropped before hydration finished do not come back', async () => {
  const { store } = setup({
    'gog:1': {
      slots: {
        'installInfo@Windows': { data: 'i' },
        launchOptions: { data: [] },
        wikiInfo: { data: 'w' }
      }
    },
    'gog:2': { slots: { wikiInfo: { data: 'w' } } }
  })
  store.dropSlots(['gog:1'], (slot) => slot !== 'wikiInfo')
  store.removeKeys(['gog:2'])
  await store.hydrate()
  expect(Object.keys(store.getEntry('gog:1')!.slots)).toEqual(['wikiInfo'])
  expect(store.getEntry('gog:2')).toBeUndefined()
})

test('dropSlots only touches the given keys', () => {
  const { store } = setup()
  store.setSlot('gog:1', 'achievements', [1])
  store.setSlot('gog:2', 'achievements', [2])
  const other = store.getEntry('gog:2')
  store.dropSlots(['gog:1'], (slot) => slot === 'achievements')
  expect(store.getSlot('gog:1', 'achievements')).toBeUndefined()
  expect(store.getEntry('gog:2')).toBe(other)
})

test('clearAll empties memory and persistence, and notifies at once', async () => {
  const { persistence, store } = setup({ 'gog:1': { slots: {} } })
  store.setSlot('gog:2', 'extraInfo@en', 'e')
  await store.clearAll()
  jest.advanceTimersByTime(1000)
  await store.flush()
  expect(store.state.getState().entries).toEqual({})
  expect(store.keys()).toEqual([])
  expect(persistence.data.size).toBe(0)
})

test('a cleared cache is not refilled by a hydration still loading', async () => {
  const { store } = setup({ 'gog:1': { slots: {} } })
  const hydrating = store.hydrate()
  await store.clearAll()
  await hydrating
  expect(store.getEntry('gog:1')).toBeUndefined()
})

test('global defaults changed during loading prevent persisted settings from returning after another restart', async () => {
  const { store, persistence } = setup({
    'settings:game-a': {
      slots: { settings: { data: { wineVersion: 'obsolete' } } }
    }
  })
  const loading = store.hydrate()
  store.dropAllSettings()
  await loading
  expect(store.getSlot('settings:game-a', 'settings')).toBeUndefined()
  await store.flush()
  const restarted = createGameDetailsStore(persistence)
  await restarted.hydrate()
  expect(restarted.getSlot('settings:game-a', 'settings')).toBeUndefined()
})
