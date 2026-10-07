import { createCliSafety } from '../gameDetails/cliSafety'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture() {
  return {
    legendary: {
      runRunnerCommand(command: unknown, options: unknown) {
        return Promise.resolve({ command, options })
      },
      getInstallInfo(appName: string, installPlatform: string) {
        return Promise.resolve({ appName, installPlatform })
      }
    },
    nile: {
      runRunnerCommand(command: unknown, options: unknown) {
        return Promise.resolve({ command, options })
      },
      getInstallInfo(appName: string) {
        return Promise.resolve(appName)
      }
    },
    gog: {
      runRunnerCommand(command: unknown, options: unknown) {
        return Promise.resolve({ command, options })
      },
      getInstallInfo(appName: string): Promise<unknown> {
        return Promise.resolve(appName)
      },
      refresh(): Promise<unknown> {
        return Promise.resolve()
      }
    }
  }
}

it('excludes a refresh arriving just after dispatch and gives refresh priority over queued installs', async () => {
  const managers = fixture()
  const finish = deferred()
  const starts: string[] = []
  managers.gog.getInstallInfo = async function (appName) {
    starts.push(appName)
    if (appName === 'first') await finish.promise
    return appName
  }
  managers.gog.refresh = function () {
    starts.push('refresh')
    return Promise.resolve('refreshed')
  }
  const safety = createCliSafety()
  safety.install(managers, jest.fn())
  const first = safety.runBackgroundInstallInfo(() =>
    managers.gog.getInstallInfo('first')
  )
  const second = managers.gog.getInstallInfo('second')
  const refresh = managers.gog.refresh()
  const third = managers.gog.getInstallInfo('third')
  expect(starts).toEqual(['first'])
  finish.resolve()
  await expect(refresh).resolves.toBe('refreshed')
  await Promise.all([first, second, third])
  expect(starts).toEqual(['first', 'refresh', 'second', 'third'])
})

it('allows nested refresh and preserves the pre-existing instance refresh wrapper', async () => {
  const managers = fixture()
  const starts: string[] = []
  const result = { synthetic: true }
  const originalRefresh = function (this: unknown) {
    expect(this).toBe(managers.gog)
    starts.push('original refresh')
    return Promise.resolve(result)
  }
  managers.gog.refresh = async function () {
    try {
      return await originalRefresh.call(this)
    } finally {
      starts.push('existing completion hook')
    }
  }
  managers.gog.getInstallInfo = async function (appName) {
    starts.push(appName)
    return this.refresh()
  }
  const safety = createCliSafety()
  safety.install(managers, jest.fn())
  await expect(
    safety.runBackgroundInstallInfo(() => managers.gog.getInstallInfo('nested'))
  ).resolves.toBe(result)
  expect(starts).toEqual([
    'nested',
    'original refresh',
    'existing completion hook'
  ])
})

it('stale inherited callbacks cannot reuse a released lease or bypass the next owner', async () => {
  const managers = fixture()
  const trigger = deferred()
  const finish = deferred()
  const starts: string[] = []
  let late!: Promise<unknown>
  managers.gog.getInstallInfo = async function (appName) {
    starts.push(appName)
    if (appName === 'first') late = trigger.promise.then(() => this.refresh())
    else await finish.promise
    return appName
  }
  managers.gog.refresh = function () {
    starts.push('refresh')
    return Promise.resolve('refresh')
  }
  createCliSafety().install(managers, jest.fn())
  await managers.gog.getInstallInfo('first')
  const second = managers.gog.getInstallInfo('second')
  trigger.resolve()
  await Promise.resolve()
  expect(starts).toEqual(['first', 'second'])
  finish.resolve()
  await Promise.all([second, late])
  expect(starts).toEqual(['first', 'second', 'refresh'])
})

it('finally releases ownership after rejection and synchronous throw', async () => {
  const managers = fixture()
  const error = new Error('synthetic transaction failure')
  managers.gog.getInstallInfo = function (appName) {
    if (appName === 'throw') throw error
    return Promise.reject(error)
  }
  const refresh = jest.fn(() => Promise.resolve('refresh'))
  managers.gog.refresh = refresh
  const safety = createCliSafety()
  safety.install(managers, jest.fn())
  await expect(managers.gog.getInstallInfo('throw')).rejects.toBe(error)
  await expect(managers.gog.getInstallInfo('reject')).rejects.toBe(error)
  await expect(managers.gog.refresh()).resolves.toBe('refresh')
  expect(refresh).toHaveBeenCalledTimes(1)
})
