import {
  createRequestBarrier,
  trackDetailsHandler
} from '../gameDetails/requestBarrier'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((release) => {
    resolve = release
  })
  return { promise, resolve }
}

test('invalidation waits for older writes and holds new requests for only its game', async () => {
  const barrier = createRequestBarrier()
  const old = deferred<string>()
  const deleted = deferred<void>()
  const drop = jest.fn(() => Promise.resolve(deleted.promise))
  const fresh = jest.fn(() => Promise.resolve('fresh'))
  const before = barrier.run('gog:1', () => Promise.resolve(old.promise))
  const invalidation = barrier.invalidate('gog:1', drop)
  const after = barrier.run('gog:1', fresh)
  await Promise.resolve()
  expect(drop).not.toHaveBeenCalled()
  expect(fresh).not.toHaveBeenCalled()
  expect(await barrier.run('gog:2', () => Promise.resolve('other'))).toBe(
    'other'
  )
  old.resolve('old')
  await before
  await Promise.resolve()
  expect(drop).toHaveBeenCalledTimes(1)
  expect(fresh).not.toHaveBeenCalled()
  deleted.resolve()
  await invalidation
  expect(await after).toBe('fresh')
})

test('failed invalidation releases waiting requests and preserves original handler arguments', async () => {
  const barrier = createRequestBarrier()
  await expect(
    barrier.invalidate('gog:1', () => {
      throw Error('failed')
    })
  ).rejects.toThrow('failed')
  const original = jest.fn((...args: unknown[]) => Promise.resolve(args))
  const registry = {
    _invokeHandlers: new Map([['getInstallInfo', original]]),
    removeHandler: jest.fn(),
    handle: jest.fn<
      void,
      [channel: string, handler: (...args: unknown[]) => unknown]
    >()
  }
  expect(
    trackDetailsHandler(registry, 'getInstallInfo', barrier, jest.fn())
  ).toBe(true)
  const handler = registry.handle.mock.calls[0][1] as (
    ...args: unknown[]
  ) => Promise<unknown>
  expect(await handler('event', '1', 'gog', 'windows', 'build')).toEqual([
    'event',
    '1',
    'gog',
    'windows',
    'build'
  ])
})

test('a changed handler registry is reported without deleting a handler', () => {
  const registry = { removeHandler: jest.fn(), handle: jest.fn() }
  expect(
    trackDetailsHandler(
      registry,
      'getExtraInfo',
      createRequestBarrier(),
      jest.fn()
    )
  ).toBe(false)
  expect(registry.removeHandler).not.toHaveBeenCalled()
})

test('play invalidation drains an older achievement cache write before fresh unlocks are read', async () => {
  const barrier = createRequestBarrier()
  const older = deferred<string[]>()
  let cache: string[] | undefined
  const before = barrier.run('gog:game-a', async () => {
    cache = await older.promise
    return cache
  })
  const invalidate = barrier.invalidate('gog:game-a', () => {
    cache = undefined
    return Promise.resolve()
  })
  const refill = barrier.run('gog:game-a', () => {
    if (!cache) cache = ['first', 'newly unlocked']
    return Promise.resolve(cache)
  })
  older.resolve(['first'])
  await before
  await invalidate
  expect(await refill).toEqual(['first', 'newly unlocked'])
  expect(cache).toEqual(['first', 'newly unlocked'])
})
