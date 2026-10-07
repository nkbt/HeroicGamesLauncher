import { createStatusTracker } from '../statusInvalidation'

test('finished install, update, uninstall, move and repair change install data', () => {
  const installing = createStatusTracker()
  expect(installing({ appName: 'game-a', status: 'installing' })).toBeNull()
  expect(installing({ appName: 'game-a', status: 'done' })).toBe(
    'installChanged'
  )
  const updating = createStatusTracker()
  expect(updating({ appName: 'game-a', status: 'updating' })).toBeNull()
  expect(updating({ appName: 'game-a', status: 'done' })).toBe('installChanged')
  const uninstalling = createStatusTracker()
  expect(uninstalling({ appName: 'game-a', status: 'uninstalling' })).toBeNull()
  expect(uninstalling({ appName: 'game-a', status: 'done' })).toBe(
    'installChanged'
  )
  const moving = createStatusTracker()
  expect(moving({ appName: 'game-a', status: 'moving' })).toBeNull()
  expect(moving({ appName: 'game-a', status: 'done' })).toBe('installChanged')
  const repairing = createStatusTracker()
  expect(repairing({ appName: 'game-a', status: 'repairing' })).toBeNull()
  expect(repairing({ appName: 'game-a', status: 'done' })).toBe(
    'installChanged'
  )
  const failed = createStatusTracker()
  failed({ appName: 'game-a', status: 'installing' })
  expect(failed({ appName: 'game-a', status: 'error' })).toBe('installChanged')
})

test('a game that stops playing reports a finished play session', () => {
  const track = createStatusTracker()
  track({ appName: '1', status: 'launching' })
  expect(track({ appName: '1', status: 'playing' })).toBeNull()
  expect(track({ appName: '1', status: 'done' })).toBe('played')
})

test('first events and repeats do nothing; games are tracked separately', () => {
  const track = createStatusTracker()
  expect(track({ appName: 'a', status: 'done' })).toBeNull()
  track({ appName: 'a', status: 'installing' })
  expect(track({ appName: 'a', status: 'installing' })).toBeNull()
  expect(track({ appName: 'b', status: 'done' })).toBeNull()
  expect(track({ appName: 'a', status: 'done' })).toBe('installChanged')
  // after a finished install the next event starts fresh
  expect(track({ appName: 'a', status: 'done' })).toBeNull()
})
