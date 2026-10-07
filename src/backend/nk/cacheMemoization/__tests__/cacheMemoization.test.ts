import CacheStore from 'backend/cache'
import LegendaryLibraryManager from 'backend/storeManagers/legendary/library'
import { installStore } from 'backend/storeManagers/legendary/electronStores'
import type { LegendaryInstallInfo } from 'common/types/legendary'
import { deleteByPrefix } from 'backend/nk/gameDetails/cacheStoreKeys'
import {
  flushMemoizedCaches,
  memoizeCacheStore,
  resumeMemoizedCaches,
  suppressMemoizedCaches
} from '../adapter'

jest.mock('electron-store')
// Keep the real launch-option consumer, with synthetic installed DLC data and
// cache hits only. No configuration, launcher, or network modules run here.
jest.mock('graceful-fs', () => ({ existsSync: () => false }))
jest.mock('backend/storeManagers/legendary/user', () => ({}))
jest.mock('backend/utils', () => ({}))
jest.mock('backend/logger', () => ({
  logDebug: jest.fn(),
  LogPrefix: { Legendary: 'synthetic' }
}))
jest.mock('backend/launcher', () => ({}))
jest.mock('backend/online_monitor', () => ({}))
jest.mock('backend/storeManagers/legendary/electronStores', () => ({
  installStore: { get: jest.fn() }
}))
jest.mock('backend/storeManagers/legendary/constants', () => ({
  legendaryConfigPath: '/synthetic-unused'
}))
jest.mock('backend/constants/environment', () => ({}))
jest.mock('backend/storeManagers/legendary/games', () => ({}))
jest.mock('backend/storeManagers/legendary/thirdParty', () => ({
  __esModule: true,
  default: {
    getInstalledGames: () => [
      ['synthetic-dlc', { executable: 'synthetic.exe' }]
    ]
  }
}))

interface InternalCache {
  store: {
    store: Record<string, unknown>
    clear: () => void
  }
  current_store: unknown
  in_memory_store: Map<string, unknown>
}
let sequence = 0
const warn = jest.fn()
function create(lifespan: number | null = null) {
  const cacheStore = new CacheStore<unknown>(
    `memo-synthetic-${sequence++}`,
    lifespan
  )
  const internalCache = cacheStore as unknown as InternalCache
  return { cacheStore, internalCache }
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'))
  resumeMemoizedCaches()
})
afterEach(() => {
  flushMemoizedCaches(warn)
  jest.useRealTimers()
})

test('identity, lazy reads, debounce, and duplicate installation', () => {
  const { cacheStore, internalCache } = create()
  const getStore = jest.spyOn(internalCache.store, 'store', 'get')
  const setStore = jest.spyOn(internalCache.store, 'store', 'set')
  const original = cacheStore
  expect(memoizeCacheStore(cacheStore, warn)).toBe(true)
  const use_in_memory: unknown = Object.getOwnPropertyDescriptor(
    cacheStore,
    'use_in_memory'
  )?.value
  expect(memoizeCacheStore(cacheStore, warn)).toBe(true)
  expect(
    Object.getOwnPropertyDescriptor(cacheStore, 'use_in_memory')?.value
  ).toBe(use_in_memory)
  expect(cacheStore).toBe(original)
  expect(getStore).not.toHaveBeenCalled()
  cacheStore.set('first', { value: 1 })
  cacheStore.set('second', null)
  expect(cacheStore.get('first')).toEqual({ value: 1 })
  expect(cacheStore.has('second')).toBe(true)
  expect(cacheStore.get('second', 'fallback')).toBeNull()
  expect(cacheStore.get('missing', 'fallback')).toBe('fallback')
  expect(getStore).toHaveBeenCalledTimes(1)
  expect(setStore).not.toHaveBeenCalled()
  jest.advanceTimersByTime(1000)
  expect(setStore).toHaveBeenCalledTimes(1)
  cacheStore.get('first')
  expect(getStore).toHaveBeenCalledTimes(1)
})

test('ordinary dot paths and JSON values match the stock backing store', () => {
  const ordinary = create()
  const memoized = create()
  memoizeCacheStore(memoized.cacheStore, warn)
  const entries: Array<[string, unknown]> = [
    ['A.B.C.', 'title'],
    ['amazon_amzn1.adg.product.x', { nested: true }],
    ['escaped\\.dot.tail', 'escaped'],
    ['empty..tail', null],
    ['array', [{ value: 'first' }, { value: 'second' }]],
    ['array.0.value', 'changed'],
    ['array.1.extra', 3],
    ['array.custom', 4],
    ['omitted.child', { toJSON: () => undefined }],
    ['number', NaN],
    ['date', new Date('2020-01-01')],
    ['nested', { missing: undefined, value: Infinity }],
    ['__proto__.unsafe', 1],
    ['safe.constructor.unsafe', 2],
    ['safe.prototype.unsafe', 3]
  ]
  for (const [key, value] of entries) {
    ordinary.cacheStore.set(key, value)
    memoized.cacheStore.set(key, value)
    expect(memoized.cacheStore.get(key)).toEqual(ordinary.cacheStore.get(key))
    expect(memoized.cacheStore.has(key)).toEqual(ordinary.cacheStore.has(key))
  }
  ordinary.cacheStore.delete('array.0.value')
  memoized.cacheStore.delete('array.0.value')
  ordinary.cacheStore.delete('array.1')
  memoized.cacheStore.delete('array.1')
  expect(memoized.cacheStore.get('array')).toEqual(
    ordinary.cacheStore.get('array')
  )
  expect(memoized.cacheStore.has('array.1')).toEqual(
    ordinary.cacheStore.has('array.1')
  )
  ordinary.cacheStore.delete('empty..tail')
  memoized.cacheStore.delete('empty..tail')
  flushMemoizedCaches(warn)
  expect(memoized.internalCache.store.store).toEqual(
    ordinary.internalCache.store.store
  )
})

test('invalid JSON values fail synchronously without filling cache entries', () => {
  const ordinary = create()
  const memoized = create()
  memoizeCacheStore(memoized.cacheStore, warn)
  const values = [undefined, Symbol('synthetic'), () => 1, BigInt(1)]
  for (const value of values) {
    expect(() => ordinary.cacheStore.set('invalid', value)).toThrow()
    expect(() => memoized.cacheStore.set('invalid', value)).toThrow()
    expect(memoized.cacheStore.has('invalid')).toBe(false)
  }
  expect(() => memoized.cacheStore.set('__internal__.private', 1)).toThrow()
})

test('timestamp expiry, default fallback, and invalidateCheck remain upstream', () => {
  const { cacheStore, internalCache } = create(60)
  memoizeCacheStore(cacheStore, warn)
  cacheStore.set('expired', 'value')
  jest.advanceTimersByTime(61 * 60000)
  expect(cacheStore.get('expired', 'fallback')).toBe('fallback')
  flushMemoizedCaches(warn)
  expect(internalCache.store.store).toEqual({ __timestamp: {} })
  const cacheStore2 = new CacheStore<string>('memo-keep-expired', 60, {
    invalidateCheck: () => false
  })
  memoizeCacheStore(cacheStore2, warn)
  cacheStore2.set('keep', 'value')
  jest.advanceTimersByTime(61 * 60000)
  expect(cacheStore2.get('keep')).toBe('value')
  const noExpiry = create(null)
  memoizeCacheStore(noExpiry.cacheStore, warn)
  noExpiry.cacheStore.set('keep', null)
  jest.setSystemTime(new Date('2050-01-01'))
  expect(noExpiry.cacheStore.get('keep', 'fallback')).toBeNull()
})

test('Map transitions preserve flat timestamp siblings through repeated cycles', () => {
  const ordinary = create(60)
  const memoized = create(60)
  memoizeCacheStore(memoized.cacheStore, warn)
  ordinary.cacheStore.set('nested.key', 'before')
  memoized.cacheStore.set('nested.key', 'before')
  ordinary.cacheStore.use_in_memory()
  memoized.cacheStore.use_in_memory()
  expect(memoized.internalCache.current_store).toBe(
    memoized.internalCache.in_memory_store
  )
  expect(memoized.internalCache.store.store).toEqual(
    ordinary.internalCache.store.store
  )
  ordinary.cacheStore.set('gog_123', 'first')
  memoized.cacheStore.set('gog_123', 'first')
  expect(memoized.cacheStore.get('gog_123')).toBe('first')
  ordinary.cacheStore.commit()
  memoized.cacheStore.commit()
  ordinary.cacheStore.set('gog_456', 'ordinary')
  memoized.cacheStore.set('gog_456', 'ordinary')
  ordinary.cacheStore.use_in_memory()
  memoized.cacheStore.use_in_memory()
  expect(memoized.cacheStore.get('gog_123')).toBe('first')
  expect(memoized.cacheStore.get('gog_456')).toBeUndefined()
  ordinary.cacheStore.set('gog_123', 'second')
  memoized.cacheStore.set('gog_123', 'second')
  ordinary.cacheStore.commit()
  memoized.cacheStore.commit()
  jest.advanceTimersByTime(5000)
  expect(memoized.internalCache.store.store).toEqual(
    ordinary.internalCache.store.store
  )
  expect(
    memoized.internalCache.store.store['__timestamp.gog_123']
  ).toBeDefined()
  expect(memoized.internalCache.store.store.__timestamp).toBeDefined()
})

test('installation while already in Map mode waits for successful commit', () => {
  const { cacheStore, internalCache } = create()
  cacheStore.use_in_memory()
  const current_store = internalCache.current_store
  expect(memoizeCacheStore(cacheStore, warn)).toBe(true)
  expect(internalCache.current_store).toBe(current_store)
  cacheStore.set('flat.key', 1)
  const setStore = jest.spyOn(internalCache.store, 'store', 'set')
  setStore.mockImplementationOnce(() => {
    throw new Error('synthetic failure')
  })
  expect(() => cacheStore.commit()).toThrow('synthetic failure')
  expect(internalCache.current_store).toBe(current_store)
  expect(cacheStore.get('flat.key')).toBe(1)
  cacheStore.commit()
  expect(internalCache.current_store).not.toBe(current_store)
  expect(internalCache.store.store['flat.key']).toBe(1)
})

test('failed flush keeps dirty writes and prevents a stale Map snapshot', () => {
  const { cacheStore, internalCache } = create()
  memoizeCacheStore(cacheStore, warn)
  cacheStore.set('pending', 'value')
  const setStore = jest.spyOn(internalCache.store, 'store', 'set')
  setStore.mockImplementationOnce(() => {
    throw new Error('synthetic failure')
  })
  expect(() => cacheStore.use_in_memory()).toThrow('synthetic failure')
  expect(internalCache.current_store).not.toBeInstanceOf(Map)
  expect(cacheStore.get('pending')).toBe('value')
  flushMemoizedCaches(warn)
  expect(internalCache.store.store.pending).toBe('value')
})

test('timer failures retry and prefix invalidation stays scoped', () => {
  const { cacheStore, internalCache } = create()
  memoizeCacheStore(cacheStore, warn)
  cacheStore.set('123_en', 1)
  cacheStore.set('123_de', 2)
  cacheStore.set('456_en', 3)
  const timestamp = Date()
  expect(deleteByPrefix(cacheStore, '123_')).toBe(2)
  const setStore = jest.spyOn(internalCache.store, 'store', 'set')
  setStore.mockImplementationOnce(() => {
    throw new Error('synthetic failure')
  })
  jest.advanceTimersByTime(1000)
  expect(cacheStore.get('456_en')).toBe(3)
  jest.advanceTimersByTime(1000)
  expect(internalCache.store.store).toEqual({
    '456_en': 3,
    __timestamp: { '456_en': timestamp }
  })
})

test('clear is synchronous and cancels later timer and exit writes', () => {
  const { cacheStore, internalCache } = create()
  memoizeCacheStore(cacheStore, warn)
  cacheStore.set('pending', 1)
  cacheStore.clear()
  const setStore = jest.spyOn(internalCache.store, 'store', 'set')
  jest.advanceTimersByTime(3000)
  flushMemoizedCaches(warn)
  expect(setStore).not.toHaveBeenCalled()
  expect(cacheStore.get('pending')).toBeUndefined()
})

test('accepted reset suppression prevents recreation and failed reset resumes dirty writes', () => {
  const { cacheStore, internalCache } = create()
  memoizeCacheStore(cacheStore, warn)
  cacheStore.set('pending', 1)
  suppressMemoizedCaches()
  const setStore = jest.spyOn(internalCache.store, 'store', 'set')
  cacheStore.set('after-reset', 2)
  jest.advanceTimersByTime(3000)
  flushMemoizedCaches(warn)
  expect(setStore).not.toHaveBeenCalled()
  resumeMemoizedCaches()
  flushMemoizedCaches(warn)
  expect(internalCache.store.store.pending).toBe(1)
  expect(internalCache.store.store['after-reset']).toBeUndefined()
})

test('shape mismatch leaves methods intact and warns once', () => {
  const use_in_memory = jest.fn()
  const target = { use_in_memory }
  const warn = jest.fn()
  expect(memoizeCacheStore(target, warn)).toBe(false)
  expect(memoizeCacheStore(target, warn)).toBe(false)
  expect(target.use_in_memory).toBe(use_in_memory)
  expect(warn).toHaveBeenCalledTimes(1)
})

test('a failed clear preserves pending data and Map clear remains upstream', () => {
  const { cacheStore, internalCache } = create()
  memoizeCacheStore(cacheStore, warn)
  cacheStore.set('pending', 1)
  const clear = jest.spyOn(internalCache.store, 'clear')
  clear.mockImplementationOnce(() => {
    throw new Error('synthetic clear failure')
  })
  expect(() => cacheStore.clear()).toThrow('synthetic clear failure')
  expect(cacheStore.get('pending')).toBe(1)
  flushMemoizedCaches(warn)
  expect(internalCache.store.store.pending).toBe(1)
  cacheStore.use_in_memory()
  cacheStore.clear()
  expect(cacheStore.has('pending')).toBe(false)
  expect(internalCache.store.store.pending).toBe(1)
  cacheStore.commit()
  expect(internalCache.store.store).toEqual({})
})

test('debounce is capped and a no-op commit does not load backing data', () => {
  const { cacheStore, internalCache } = create()
  memoizeCacheStore(cacheStore, warn, 10000)
  const getStore = jest.spyOn(internalCache.store, 'store', 'get')
  cacheStore.commit()
  expect(getStore).not.toHaveBeenCalled()
  cacheStore.set('pending', 1)
  const setStore = jest.spyOn(internalCache.store, 'store', 'set')
  jest.advanceTimersByTime(1999)
  expect(setStore).not.toHaveBeenCalled()
  jest.advanceTimersByTime(1)
  expect(setStore).toHaveBeenCalledTimes(1)
})

test('readonly use_in_memory leaves the upstream instance intact', () => {
  const { cacheStore, internalCache } = create()
  const use_in_memory: unknown = Reflect.get(cacheStore, 'use_in_memory')
  const commit: unknown = Reflect.get(cacheStore, 'commit')
  const current_store = internalCache.current_store
  Object.defineProperty(cacheStore, 'use_in_memory', {
    value: Reflect.get(cacheStore, 'use_in_memory') as unknown,
    writable: false,
    configurable: true
  })
  const warn = jest.fn()
  expect(memoizeCacheStore(cacheStore, warn)).toBe(false)
  expect(memoizeCacheStore(cacheStore, warn)).toBe(false)
  expect(Reflect.get(cacheStore, 'use_in_memory')).toBe(use_in_memory)
  expect(Reflect.get(cacheStore, 'commit')).toBe(commit)
  expect(internalCache.current_store).toBe(current_store)
  expect(warn).toHaveBeenCalledTimes(1)
  cacheStore.set('original', 1)
  expect(internalCache.store.store.original).toBe(1)
})

test('readonly commit leaves the upstream instance intact', () => {
  const { cacheStore, internalCache } = create()
  const use_in_memory: unknown = Reflect.get(cacheStore, 'use_in_memory')
  const commit: unknown = Reflect.get(cacheStore, 'commit')
  const current_store = internalCache.current_store
  Object.defineProperty(cacheStore, 'commit', {
    value: Reflect.get(cacheStore, 'commit') as unknown,
    writable: false,
    configurable: true
  })
  const warn = jest.fn()
  expect(memoizeCacheStore(cacheStore, warn)).toBe(false)
  expect(memoizeCacheStore(cacheStore, warn)).toBe(false)
  expect(Reflect.get(cacheStore, 'use_in_memory')).toBe(use_in_memory)
  expect(Reflect.get(cacheStore, 'commit')).toBe(commit)
  expect(internalCache.current_store).toBe(current_store)
  expect(warn).toHaveBeenCalledTimes(1)
  cacheStore.set('original', 1)
  expect(internalCache.store.store.original).toBe(1)
})

test('readonly current_store leaves the upstream instance intact', () => {
  const { cacheStore, internalCache } = create()
  const use_in_memory: unknown = Reflect.get(cacheStore, 'use_in_memory')
  const commit: unknown = Reflect.get(cacheStore, 'commit')
  const current_store = internalCache.current_store
  Object.defineProperty(cacheStore, 'current_store', {
    value: Reflect.get(cacheStore, 'current_store') as unknown,
    writable: false,
    configurable: true
  })
  const warn = jest.fn()
  expect(memoizeCacheStore(cacheStore, warn)).toBe(false)
  expect(memoizeCacheStore(cacheStore, warn)).toBe(false)
  expect(Reflect.get(cacheStore, 'use_in_memory')).toBe(use_in_memory)
  expect(Reflect.get(cacheStore, 'commit')).toBe(commit)
  expect(internalCache.current_store).toBe(current_store)
  expect(warn).toHaveBeenCalledTimes(1)
  cacheStore.set('original', 1)
  expect(internalCache.store.store.original).toBe(1)
})

test('a sealed instance with inherited lifecycle methods is left intact', () => {
  const { cacheStore, internalCache } = create()
  const current_store = internalCache.current_store
  Object.preventExtensions(cacheStore)
  const warn = jest.fn()
  expect(memoizeCacheStore(cacheStore, warn)).toBe(false)
  expect(internalCache.current_store).toBe(current_store)
  expect(warn).toHaveBeenCalledTimes(1)
})

test('reads and whole-store access are detached, while fallback identity stays exact', () => {
  const ordinary = create()
  const memoized = create()
  memoizeCacheStore(memoized.cacheStore, warn)
  const value = { nested: { count: 1 }, list: ['original'], omitted: undefined }
  ordinary.cacheStore.set('value', value)
  memoized.cacheStore.set('value', value)
  value.nested.count = 2
  value.list.push('after-set')
  const ordinaryValue = ordinary.cacheStore.get('value') as typeof value
  const memoizedValue = memoized.cacheStore.get('value') as typeof value
  ordinaryValue.nested.count = 3
  memoizedValue.nested.count = 3
  ordinaryValue.list.push('after-get')
  memoizedValue.list.push('after-get')
  expect(memoized.cacheStore.get('value')).toEqual(
    ordinary.cacheStore.get('value')
  )
  const memoizedStore = (
    memoized.internalCache.current_store as { store: Record<string, unknown> }
  ).store
  const ordinaryStore = ordinary.internalCache.store.store
  expect(Object.getPrototypeOf(memoizedStore)).toBe(
    Object.getPrototypeOf(ordinaryStore)
  )
  ;(memoizedStore.value as typeof value).list.push('whole-store')
  ;(ordinaryStore.value as typeof value).list.push('whole-store')
  memoizedStore.injected = true
  ordinaryStore.injected = true
  const fallback = { exact: true }
  expect(ordinary.cacheStore.get('missing', fallback)).toBe(fallback)
  expect(memoized.cacheStore.get('missing', fallback)).toBe(fallback)
  ordinary.cacheStore.set('unrelated', true)
  memoized.cacheStore.set('unrelated', true)
  flushMemoizedCaches(warn)
  expect(memoized.internalCache.store.store).toEqual(
    ordinary.internalCache.store.store
  )
  expect(memoized.internalCache.store.store.injected).toBeUndefined()
})

test('actual repeated Legendary launch-option reads never persist appended DLC options', async () => {
  const ordinary = create()
  const memoized = create()
  memoizeCacheStore(memoized.cacheStore, warn)
  const installInfo = {
    manifest: { synthetic: true },
    game: {
      launch_options: [{ type: 'basic', name: 'Base', parameters: '' }],
      owned_dlc: [{ app_name: 'synthetic-dlc', title: 'Synthetic DLC' }]
    }
  }
  ordinary.cacheStore.set('synthetic-game', installInfo)
  memoized.cacheStore.set('synthetic-game', installInfo)
  const manager = new LegendaryLibraryManager()
  manager.refreshInstalled()
  jest.spyOn(manager, 'getGameInfo').mockReturnValue({
    install: { platform: 'Windows' }
  } as ReturnType<typeof manager.getGameInfo>)
  jest
    .spyOn(installStore, 'get')
    .mockImplementation(
      () => ordinary.cacheStore.get('synthetic-game') as LegendaryInstallInfo
    )
  const ordinaryFirst = await manager.getLaunchOptions('synthetic-game')
  const ordinarySecond = await manager.getLaunchOptions('synthetic-game')
  jest
    .spyOn(installStore, 'get')
    .mockImplementation(
      () => memoized.cacheStore.get('synthetic-game') as LegendaryInstallInfo
    )
  const memoizedFirst = await manager.getLaunchOptions('synthetic-game')
  const memoizedSecond = await manager.getLaunchOptions('synthetic-game')
  expect(ordinaryFirst).toHaveLength(2)
  expect(ordinarySecond).toEqual(ordinaryFirst)
  expect(memoizedFirst).toEqual(ordinaryFirst)
  expect(memoizedSecond).toEqual(ordinarySecond)
  ordinary.cacheStore.set('unrelated', true)
  memoized.cacheStore.set('unrelated', true)
  flushMemoizedCaches(warn)
  expect(memoized.internalCache.store.store).toEqual(
    ordinary.internalCache.store.store
  )
  expect(memoized.cacheStore.get('synthetic-game')).toEqual(installInfo)
})

test('Map mode retains original mutable references and set argument semantics', () => {
  const ordinary = create()
  const memoized = create()
  memoizeCacheStore(memoized.cacheStore, warn)
  ordinary.cacheStore.use_in_memory()
  memoized.cacheStore.use_in_memory()
  const ordinaryValue = { list: ['initial'] }
  const memoizedValue = { list: ['initial'] }
  ordinary.cacheStore.set('value', ordinaryValue)
  memoized.cacheStore.set('value', memoizedValue)
  ordinaryValue.list.push('argument-mutation')
  memoizedValue.list.push('argument-mutation')
  expect(ordinary.cacheStore.get('value')).toBe(ordinaryValue)
  expect(memoized.cacheStore.get('value')).toBe(memoizedValue)
  ;(ordinary.cacheStore.get('value') as typeof ordinaryValue).list.push(
    'read-mutation'
  )
  ;(memoized.cacheStore.get('value') as typeof memoizedValue).list.push(
    'read-mutation'
  )
  ordinary.cacheStore.commit()
  memoized.cacheStore.commit()
  expect(memoized.internalCache.store.store).toEqual(
    ordinary.internalCache.store.store
  )
  const committed = memoized.cacheStore.get('value') as typeof memoizedValue
  expect(committed).not.toBe(memoizedValue)
  committed.list.push('detached-after-commit')
  expect(memoized.cacheStore.get('value')).toEqual(
    ordinary.cacheStore.get('value')
  )
})
