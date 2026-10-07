import { EventEmitter } from 'events'
import { guardResetHeroic } from '../gameDetails/reset'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

function setup() {
  const registry = new EventEmitter()
  const original = jest.fn(function (this: unknown, ...args: unknown[]) {
    return [this, ...args]
  })
  registry.on('resetHeroic', original)
  const warn = jest.fn()
  const send = jest.fn<void, [channel: string, requestId: number]>()
  const frame = {
    send,
    url: 'https://app.example/#/library',
    origin: 'https://app.example',
    frameToken: 'document-a',
    detached: false
  }
  const sender = Object.assign(new EventEmitter(), {
    send,
    mainFrame: frame,
    isDestroyed: () => false
  })
  const options = {
    getMainWindow: () => ({ webContents: sender as never }),
    rendererEntry: 'https://app.example/',
    timeoutMs: 100
  }
  expect(guardResetHeroic(registry as never, warn, options)).toBe(true)
  const event = { sender, senderFrame: frame }
  return { registry, original, warn, sender, event, frame, options }
}

test('reset waits for the same request and originating window and keeps the original receiver and arguments', () => {
  const t = setup()
  t.registry.emit('resetHeroic', t.event, 'argument')
  expect(t.original).not.toHaveBeenCalled()
  const requestId = t.sender.send.mock.calls[0][1]
  t.registry.emit(
    'gameDetailsResetReady',
    { sender: { send: jest.fn() } },
    requestId,
    true
  )
  t.registry.emit('gameDetailsResetReady', t.event, requestId + 1, true)
  expect(t.original).not.toHaveBeenCalled()
  t.registry.emit('gameDetailsResetReady', t.event, requestId, true)
  expect(t.original).toHaveBeenCalledWith(t.event, 'argument')
  expect(t.original.mock.contexts[0]).toBe(t.registry)
  t.registry.emit('gameDetailsResetReady', t.event, requestId, true)
  jest.advanceTimersByTime(100)
  expect(t.original).toHaveBeenCalledTimes(1)
  expect(t.warn).not.toHaveBeenCalled()
})

test('failure, timeout and stale acknowledgement cannot run the destructive reset', () => {
  const t = setup()
  t.registry.emit('resetHeroic', t.event)
  const first = t.sender.send.mock.calls[0][1]
  t.registry.emit('gameDetailsResetReady', t.event, first, false)
  expect(t.original).not.toHaveBeenCalled()
  t.registry.emit('resetHeroic', t.event)
  const second = t.sender.send.mock.calls[1][1]
  jest.advanceTimersByTime(100)
  t.registry.emit('resetHeroic', t.event)
  expect(t.sender.send.mock.calls[2]).toEqual([
    'resetGameDetailsCancelled',
    second
  ])
  const third = t.sender.send.mock.calls[3][1]
  t.registry.emit('gameDetailsResetReady', t.event, second, true)
  expect(t.original).not.toHaveBeenCalled()
  t.registry.emit('gameDetailsResetReady', t.event, third, true)
  expect(t.original).toHaveBeenCalledTimes(1)
  expect(t.warn).toHaveBeenCalledTimes(2)
})

test('duplicate installation is inert and unexpected listener shape disables destructive reset', () => {
  const t = setup()
  expect(guardResetHeroic(t.registry as never, t.warn, t.options)).toBe(true)
  expect(t.registry.listenerCount('resetHeroic')).toBe(1)
  expect(t.registry.listenerCount('gameDetailsResetReady')).toBe(1)
  const unknown = new EventEmitter()
  expect(guardResetHeroic(unknown as never, t.warn, t.options)).toBe(false)
  expect(unknown.listenerCount('resetHeroic')).toBe(1)
})

test('original reset errors retain their event-handler semantics', () => {
  const t = setup()
  t.original.mockImplementationOnce(() => {
    throw Error('original failure')
  })
  t.registry.emit('resetHeroic', t.event)
  const requestId = t.sender.send.mock.calls[0][1]
  expect(() =>
    t.registry.emit('gameDetailsResetReady', t.event, requestId, true)
  ).toThrow('original failure')
})

test('multiple destructive listeners fail closed', () => {
  const t = setup()
  const registry = new EventEmitter()
  const first = jest.fn()
  const second = jest.fn()
  registry.on('resetHeroic', first)
  registry.on('resetHeroic', second)
  expect(guardResetHeroic(registry as never, t.warn, t.options)).toBe(false)
  registry.emit('resetHeroic', t.event)
  expect(first).not.toHaveBeenCalled()
  expect(second).not.toHaveBeenCalled()
})

test('a subframe or changed document cannot acknowledge an originating clear', () => {
  const t = setup()
  t.registry.emit('resetHeroic', t.event)
  const requestId = t.sender.send.mock.calls[0][1]
  t.registry.emit(
    'gameDetailsResetReady',
    { sender: t.sender, senderFrame: { ...t.frame } },
    requestId,
    true
  )
  t.frame.frameToken = 'document-b'
  t.registry.emit('gameDetailsResetReady', t.event, requestId, true)
  expect(t.original).not.toHaveBeenCalled()
  t.frame.frameToken = 'document-a'
  t.frame.origin = 'https://other.example'
  t.registry.emit('gameDetailsResetReady', t.event, requestId, true)
  expect(t.original).not.toHaveBeenCalled()
})

test('reload cancels the request even when frame and URL stay equal', () => {
  const t = setup()
  t.registry.emit('resetHeroic', t.event)
  const requestId = t.sender.send.mock.calls[0][1]
  t.sender.emit('did-start-navigation', {
    isMainFrame: true,
    isSameDocument: false
  })
  t.registry.emit('gameDetailsResetReady', t.event, requestId, true)
  expect(t.original).not.toHaveBeenCalled()
  expect(t.sender.send).toHaveBeenCalledWith(
    'resetGameDetailsCancelled',
    requestId
  )
  expect(t.sender.listenerCount('did-start-navigation')).toBe(0)
  expect(t.sender.listenerCount('destroyed')).toBe(0)
})

test('untrusted entry refuses reset and hash route changes retain the same document', () => {
  const t = setup()
  t.frame.url = 'https://other.example/'
  t.registry.emit('resetHeroic', t.event)
  expect(t.sender.send).not.toHaveBeenCalled()
  t.frame.url = 'https://app.example/#/settings'
  t.registry.emit('resetHeroic', t.event)
  const requestId = t.sender.send.mock.calls[0][1]
  t.sender.emit('did-start-navigation', {
    isMainFrame: true,
    isSameDocument: true
  })
  t.registry.emit('gameDetailsResetReady', t.event, requestId, true)
  expect(t.original).toHaveBeenCalledTimes(1)
  expect(t.sender.listenerCount('destroyed')).toBe(0)
})

test('destroyed renderer cancels and releases lifecycle listeners', () => {
  const t = setup()
  t.registry.emit('resetHeroic', t.event)
  const requestId = t.sender.send.mock.calls[0][1]
  t.sender.emit('render-process-gone')
  t.registry.emit('gameDetailsResetReady', t.event, requestId, true)
  expect(t.original).not.toHaveBeenCalled()
  expect(t.sender.listenerCount('render-process-gone')).toBe(0)
})

test('packaged reset requires the exact configured file entry and the same recorded origin', () => {
  const t = setup()
  const registry = new EventEmitter()
  const original = jest.fn()
  registry.on('resetHeroic', original)
  t.frame.url = 'file:///app/index.html#/console'
  t.frame.origin = 'null'
  guardResetHeroic(registry as never, t.warn, {
    ...t.options,
    rendererEntry: 'file:///app/index.html'
  })
  registry.emit('resetHeroic', t.event)
  const requestId = t.sender.send.mock.calls[0][1]
  t.frame.url = 'file:///other/index.html'
  registry.emit('gameDetailsResetReady', t.event, requestId, true)
  expect(original).not.toHaveBeenCalled()
  t.frame.url = 'file:///app/index.html#/settings'
  registry.emit('gameDetailsResetReady', t.event, requestId, true)
  expect(original).toHaveBeenCalledTimes(1)
})
