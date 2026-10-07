import { createCliSafety } from '../gameDetails/cliSafety'

function fixture() {
  return {
    legendary: {
      runRunnerCommand: function (command: unknown, options: unknown): unknown {
        return Promise.resolve({ command, options, receiver: this })
      },
      getInstallInfo(appName: string, installPlatform: string) {
        return Promise.resolve({ appName, installPlatform })
      }
    },
    gog: {
      runRunnerCommand: function (command: unknown, options: unknown): unknown {
        return Promise.resolve({ command, options, receiver: this })
      },
      getInstallInfo(appName: string) {
        return Promise.resolve(appName)
      },
      refresh() {
        return Promise.resolve('refresh')
      }
    },
    nile: {
      runRunnerCommand: function (command: unknown, options: unknown): unknown {
        return Promise.resolve({ command, options, receiver: this })
      },
      getInstallInfo(appName: string) {
        return Promise.resolve(appName)
      }
    }
  }
}

it('spaces synthetic process starts despite variable pre-spawn lag across runners', async () => {
  let time = 0
  const starts: number[] = []
  const safety = createCliSafety({
    now: () => time,
    wait: (milliseconds) => {
      time += milliseconds
      return Promise.resolve()
    }
  })
  const managers = fixture()
  managers.legendary.runRunnerCommand = function (command, options) {
    time += 9000
    starts.push(time)
    time += 100
    return Promise.resolve({ command, options, receiver: this })
  }
  managers.gog.runRunnerCommand = function (command, options) {
    starts.push(time)
    time += 40
    return Promise.resolve({ command, options, receiver: this })
  }
  managers.nile.runRunnerCommand = function (command, options) {
    time += 20
    starts.push(time)
    return Promise.resolve({ command, options, receiver: this })
  }
  expect(safety.install(managers, jest.fn())).toBe(true)
  await safety.runBackgroundInstallInfo(async () => {
    await managers.legendary.runRunnerCommand('info', {})
    await managers.gog.runRunnerCommand('auth', {})
    await managers.gog.runRunnerCommand('info', {})
    await managers.legendary.runRunnerCommand('retry', {})
    await managers.nile.runRunnerCommand('info', {})
  })
  expect(starts).toEqual([9000, 14100, 19140, 33180, 38300])
})

it('holds serialization until original settlement while foreground calls bypass', async () => {
  let finish!: () => void
  let time = 0
  const safety = createCliSafety({
    now: () => time,
    wait: (ms) => {
      time += ms
      return Promise.resolve()
    }
  })
  const managers = fixture()
  const starts: string[] = []
  managers.legendary.runRunnerCommand = function (command, options) {
    starts.push(String(command))
    return new Promise((resolve) => {
      finish = () => resolve({ command, options })
    })
  }
  managers.gog.runRunnerCommand = function (command, options) {
    starts.push(String(command))
    return Promise.resolve({ command, options, receiver: this })
  }
  safety.install(managers, jest.fn())
  const first = safety.runBackgroundInstallInfo(() =>
    Promise.resolve(managers.legendary.runRunnerCommand('slow', {}))
  )
  await Promise.resolve()
  const second = safety.runBackgroundInstallInfo(() =>
    Promise.resolve(managers.gog.runRunnerCommand('queued', {}))
  )
  await managers.gog.runRunnerCommand('foreground', {})
  expect(starts).toEqual(['slow', 'foreground'])
  finish()
  await Promise.all([first, second])
  expect(starts).toEqual(['slow', 'foreground', 'queued'])
  expect(time).toBe(5000)
})

it('retains receiver, argument identity, result, throws and rejection and releases failed runners', async () => {
  let time = 0
  const safety = createCliSafety({
    now: () => time,
    wait: (ms) => {
      time += ms
      return Promise.resolve()
    }
  })
  const managers = fixture()
  const command = ['info']
  const options = { build: 'synthetic' }
  const error = new Error('synthetic failure')
  managers.gog.runRunnerCommand = function (command, options) {
    void command
    void options
    throw error
  }
  safety.install(managers, jest.fn())
  expect(() => managers.gog.runRunnerCommand(command, options)).toThrow(error)
  await expect(
    safety.runBackgroundInstallInfo(() =>
      Promise.resolve(managers.gog.runRunnerCommand(command, options))
    )
  ).rejects.toBe(error)
  const result = await safety.runBackgroundInstallInfo(() =>
    Promise.resolve(managers.nile.runRunnerCommand(command, options))
  )
  expect(result).toEqual({ command, options, receiver: managers.nile })
  expect(time).toBe(5000)
  // Capture identity only; the method is never called without its receiver.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = managers.legendary.runRunnerCommand
  expect(safety.install(managers, jest.fn())).toBe(true)
  // Compare identity only; preserving the instance method is the assertion.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(managers.legendary.runRunnerCommand).toBe(original)
})

it('denies stale inherited slow authority after its operation settles', async () => {
  let time = 0
  let late!: () => unknown
  const safety = createCliSafety({
    now: () => time,
    wait: (ms) => {
      time += ms
      return Promise.resolve()
    }
  })
  const managers = fixture()
  safety.install(managers, jest.fn())
  await safety.runBackgroundInstallInfo(async () => {
    await managers.nile.runRunnerCommand('first', {})
    // Promise continuation inherits this operation's context.
    const trigger = new Promise<void>((resolve) => {
      late = resolve
    })
    void trigger.then(() => managers.nile.runRunnerCommand('late', {}))
  })
  late()
  await Promise.resolve()
  await Promise.resolve()
  expect(time).toBe(0)
})

it('fails atomically for changed shapes or a non-writable target and warns once', async () => {
  const safety = createCliSafety()
  const managers = fixture()
  // Capture identity only; the method is never called without its receiver.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = managers.legendary.runRunnerCommand
  Object.freeze(managers.gog)
  const warn = jest.fn()
  expect(safety.install(managers, warn)).toBe(false)
  expect(safety.install(managers, warn)).toBe(false)
  // Compare identity only; preserving the instance method is the assertion.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(managers.legendary.runRunnerCommand).toBe(original)
  expect(warn).toHaveBeenCalledTimes(1)
  await expect(
    safety.runBackgroundInstallInfo(() => Promise.resolve('never'))
  ).rejects.toThrow('safety unavailable')
  await expect(managers.gog.getInstallInfo('foreground')).resolves.toBe(
    'foreground'
  )
  const malformed = fixture()
  malformed.nile.runRunnerCommand = () => Promise.resolve(null)
  expect(createCliSafety().install(malformed, jest.fn())).toBe(false)
})

it('paces nested auth/info and recursive manifest retries while cache hits do no runner work', async () => {
  let time = 0
  const starts: number[] = []
  const safety = createCliSafety({
    now: () => time,
    wait: (ms) => {
      time += ms
      return Promise.resolve()
    }
  })
  const managers = fixture()
  managers.gog.runRunnerCommand = function (command, options) {
    starts.push(time)
    return Promise.resolve({ command, options, receiver: this })
  }
  managers.gog.getInstallInfo = async function (appName) {
    if (appName === 'cached') return appName
    await this.runRunnerCommand('auth', {})
    await this.runRunnerCommand('info', {})
    return appName
  }
  managers.legendary.runRunnerCommand = function (command, options) {
    starts.push(time)
    return Promise.resolve({ command, options, receiver: this })
  }
  managers.legendary.getInstallInfo = async function (
    appName,
    installPlatform
  ) {
    await this.runRunnerCommand('info', {})
    if (appName === 'retry')
      await this.getInstallInfo('manifest', installPlatform)
    return { appName, installPlatform }
  }
  safety.install(managers, jest.fn())
  await safety.runBackgroundInstallInfo(() =>
    managers.gog.getInstallInfo('cached')
  )
  expect(starts).toEqual([])
  expect(time).toBe(0)
  await safety.runBackgroundInstallInfo(() =>
    managers.gog.getInstallInfo('missing')
  )
  await safety.runBackgroundInstallInfo(() =>
    managers.legendary.getInstallInfo('retry', 'windows')
  )
  expect(starts).toEqual([0, 5000, 10000, 15000])
})

it('rechecks early timer wakeups before invoking a slow runner', async () => {
  let time = 0
  let waits = 0
  const safety = createCliSafety({
    now: () => time,
    wait: (ms) => {
      time += waits++ === 0 ? ms - 1 : ms
      return Promise.resolve()
    }
  })
  const managers = fixture()
  safety.install(managers, jest.fn())
  await safety.runBackgroundInstallInfo(async () => {
    await managers.nile.runRunnerCommand('first', {})
    await managers.nile.runRunnerCommand('next', {})
  })
  expect(time).toBe(5000)
  expect(waits).toBe(2)
})

it('registers the exact background positional contract once and uses the existing per-game barrier', async () => {
  const managers = fixture()
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const addHandler = jest.fn(
    (channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)
  )
  const run = jest.fn(async (_key: string, operation: () => Promise<unknown>) =>
    operation()
  )
  const logError = jest.fn()
  jest.isolateModules(() => {
    jest.doMock('backend/ipc', () => ({ addHandler }))
    jest.doMock('backend/logger', () => ({
      logWarning: jest.fn(),
      logError,
      LogPrefix: { Backend: 'backend', Legendary: 'legendary', Gog: 'gog' }
    }))
    jest.doMock('backend/storeManagers', () => ({
      libraryManagerMap: managers
    }))
    jest.doMock('../gameDetails/requestBarrier', () => ({
      requestBarrier: { run }
    }))
    const backgroundInstallInfo = jest.requireActual<
      typeof import('../gameDetails/backgroundInstallInfo')
    >('../gameDetails/backgroundInstallInfo')
    expect(backgroundInstallInfo.initGameDetailsBackgroundInstallInfo()).toBe(
      true
    )
    expect(backgroundInstallInfo.initGameDetailsBackgroundInstallInfo()).toBe(
      true
    )
  })
  const handler = handlers.get('getInstallInfoBackground')!
  const getInstallInfo = jest.fn((appName: string, installPlatform: string) =>
    Promise.resolve({ appName, installPlatform })
  )
  managers.legendary.getInstallInfo = getInstallInfo
  await expect(
    handler({}, 'synthetic', 'legendary', 'windows', 'build', 'branch')
  ).resolves.toEqual({ appName: 'synthetic', installPlatform: 'windows' })
  expect(getInstallInfo).toHaveBeenCalledWith('synthetic', 'windows', {
    build: 'build',
    branch: 'branch'
  })
  expect(run.mock.calls[0][0]).toBe('legendary:synthetic')
  expect(addHandler).toHaveBeenCalledTimes(1)
  managers.nile.getInstallInfo = () => Promise.resolve(undefined as never)
  await expect(
    handler({}, 'synthetic', 'nile', 'linux', undefined, undefined)
  ).resolves.toBeNull()
  const error = new Error('synthetic transport failure')
  managers.legendary.getInstallInfo = () => Promise.reject(error)
  await expect(
    handler({}, 'synthetic', 'legendary', 'windows')
  ).resolves.toBeNull()
  expect(logError).toHaveBeenCalledWith(error, 'legendary')
})
