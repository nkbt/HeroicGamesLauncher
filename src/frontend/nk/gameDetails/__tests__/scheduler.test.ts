import { createDetailsScheduler } from '../scheduler'

const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(0)
})
afterEach(() => {
  jest.useRealTimers()
})
test('play pauses foreground and local requests; hot readers need no scheduler', async () => {
  const scheduler = createDetailsScheduler()
  scheduler.update({ online: true, playing: true })
  const work = jest.fn(() => Promise.resolve('value'))
  const request = scheduler.enqueue(
    { id: 'a', key: 'gog:a', lane: 'local', network: false, priority: 0 },
    work
  )
  await tick()
  expect(work).not.toHaveBeenCalled()
  scheduler.update({ playing: false, launching: true })
  await tick()
  expect(work).not.toHaveBeenCalled()
  scheduler.update({ launching: false })
  expect(await request).toBe('value')
  expect(work).toHaveBeenCalledTimes(1)
})
test('network pauses through downloads and check-online while local work proceeds', async () => {
  const scheduler = createDetailsScheduler()
  scheduler.update({ online: true, downloading: true })
  const network = jest.fn(() => Promise.resolve('network'))
  const request = scheduler.enqueue(
    { id: 'a', key: 'gog:a', lane: 'storeApi', network: true, priority: 2 },
    network
  )
  expect(
    await scheduler.enqueue(
      { id: 'b', key: 'gog:b', lane: 'local', network: false, priority: 2 },
      () => Promise.resolve('local')
    )
  ).toBe('local')
  scheduler.update({ online: false, downloading: false })
  await tick()
  expect(network).not.toHaveBeenCalled()
  scheduler.update({ online: true })
  expect(await request).toBe('network')
})
test('page promotion shares a queued wiki request and bypasses background spacing', async () => {
  const scheduler = createDetailsScheduler()
  scheduler.update({ online: true })
  await scheduler.enqueue(
    {
      id: 'first',
      key: 'gog:first',
      lane: 'wiki',
      network: true,
      priority: 2
    },
    () => Promise.resolve(null)
  )
  await tick()
  const work = jest.fn(() => Promise.resolve({ value: 1 }))
  const background = scheduler.enqueue(
    { id: 'a', key: 'gog:a', lane: 'wiki', network: true, priority: 2 },
    work
  )
  await tick()
  expect(work).not.toHaveBeenCalled()
  const foreground = scheduler.enqueue(
    { id: 'a', key: 'gog:a', lane: 'wiki', network: true, priority: 0 },
    work
  )
  expect(foreground).toBe(background)
  expect(await foreground).toEqual({ value: 1 })
  expect(work).toHaveBeenCalledTimes(1)
})
test('slow install waits for every other queued runnable lane and active work', async () => {
  const scheduler = createDetailsScheduler()
  scheduler.update({ online: true, playing: true })
  const slow = jest.fn(() => Promise.resolve(null))
  const local = deferred()
  const slowRequest = scheduler.enqueue(
    {
      id: 'slow',
      key: 'gog:slow',
      lane: 'installInfoBackground',
      network: true,
      priority: 2
    },
    slow
  )
  const localRequest = scheduler.enqueue(
    {
      id: 'local',
      key: 'gog:local',
      lane: 'local',
      network: false,
      priority: 2
    },
    () => local.promise
  )
  scheduler.update({ playing: false })
  await tick()
  expect(slow).not.toHaveBeenCalled()
  local.resolve()
  await localRequest
  await slowRequest
  expect(slow).toHaveBeenCalledTimes(1)
})
test('latest hover runs first and leave cannot cancel a promoted page request', async () => {
  const scheduler = createDetailsScheduler()
  scheduler.update({ online: true, playing: true })
  const starts: string[] = []
  const earlier = scheduler.enqueue(
    { id: 'a', key: 'gog:a', lane: 'wiki', network: true, priority: 1 },
    () => {
      starts.push('a')
      return Promise.resolve()
    }
  )
  const latest = scheduler.enqueue(
    { id: 'b', key: 'gog:b', lane: 'wiki', network: true, priority: 1 },
    () => {
      starts.push('b')
      return Promise.resolve()
    }
  )
  scheduler.promote('a', 0)
  scheduler.cancel('gog:a', true)
  scheduler.update({ playing: false })
  await earlier
  await tick()
  jest.advanceTimersByTime(1000)
  await latest
  expect(starts).toEqual(['a', 'b'])
})

test('hover intent order is LIFO within its lane and library refresh retains spacing', async () => {
  const scheduler = createDetailsScheduler()
  scheduler.update({ online: true, refreshing: true })
  const starts: string[] = []
  const earlier = scheduler.enqueue(
    {
      id: 'earlier',
      key: 'gog:earlier',
      lane: 'wiki',
      network: true,
      priority: 1
    },
    () => {
      starts.push('earlier')
      return Promise.resolve()
    }
  )
  const latest = scheduler.enqueue(
    {
      id: 'latest',
      key: 'gog:latest',
      lane: 'wiki',
      network: true,
      priority: 1
    },
    () => {
      starts.push('latest')
      return Promise.resolve()
    }
  )
  scheduler.update({ refreshing: false })
  await latest
  await tick()
  expect(starts).toEqual(['latest'])
  scheduler.update({ refreshing: true })
  jest.advanceTimersByTime(500)
  scheduler.update({ refreshing: false })
  await tick()
  expect(starts).toEqual(['latest'])
  jest.advanceTimersByTime(500)
  await earlier
  expect(starts).toEqual(['latest', 'earlier'])
})

test('background store starts are spaced and at most two requests run together', async () => {
  const scheduler = createDetailsScheduler()
  scheduler.update({ online: true })
  const first = deferred()
  const second = deferred()
  const third = deferred()
  const starts: number[] = []
  const a = scheduler.enqueue(
    { id: 'a', key: 'gog:a', lane: 'storeApi', network: true, priority: 2 },
    () => {
      starts.push(Date.now())
      return first.promise
    }
  )
  const b = scheduler.enqueue(
    { id: 'b', key: 'gog:b', lane: 'storeApi', network: true, priority: 2 },
    () => {
      starts.push(Date.now())
      return second.promise
    }
  )
  const c = scheduler.enqueue(
    { id: 'c', key: 'gog:c', lane: 'storeApi', network: true, priority: 2 },
    () => {
      starts.push(Date.now())
      return third.promise
    }
  )
  await tick()
  expect(starts).toEqual([0])
  jest.advanceTimersByTime(250)
  await tick()
  expect(starts).toEqual([0, 250])
  jest.advanceTimersByTime(250)
  await tick()
  expect(starts).toEqual([0, 250])
  first.resolve()
  await a
  await tick()
  expect(starts).toEqual([0, 250, 500])
  second.resolve()
  third.resolve()
  await b
  await c
})
