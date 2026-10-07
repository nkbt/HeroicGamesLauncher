// nk: #5 - serialize slow commands through settlement before pacing the next.
import { AsyncLocalStorage } from 'async_hooks'
import { performance } from 'perf_hooks'

type Method = (this: unknown, ...args: unknown[]) => unknown
type Manager = {
  runRunnerCommand?: unknown
  getInstallInfo?: unknown
  refresh?: unknown
}
type Managers = { legendary: Manager; gog: Manager; nile: Manager }
type Lease = { active: boolean }

export function createCliSafety({
  now = () => performance.now(),
  wait = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}: {
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
} = {}) {
  const slowContext = new AsyncLocalStorage<Lease>()
  const gogContext = new AsyncLocalStorage<Lease>()
  let runnerTail: Promise<unknown> = Promise.resolve()
  let settledAt: number | undefined
  let activeOwner: Lease | undefined
  const refreshQueue: Array<() => void> = []
  const installQueue: Array<() => void> = []
  let installed: Managers | undefined
  let ready = false
  let warned = false

  function runRunner(original: Method, receiver: unknown, args: unknown[]) {
    const lease = slowContext.getStore()
    if (!lease?.active) return original.apply(receiver, args)
    const promise = runnerTail.then(async () => {
      if (settledAt !== undefined) {
        let remaining = settledAt + 5000 - now()
        while (remaining > 0) {
          await wait(remaining)
          remaining = settledAt + 5000 - now()
        }
      }
      try {
        return await original.apply(receiver, args)
      } finally {
        settledAt = now()
      }
    })
    runnerTail = promise.catch(() => undefined)
    return promise
  }

  function gogTransaction(
    original: Method,
    receiver: unknown,
    args: unknown[],
    refresh: boolean
  ): Promise<unknown> {
    const lease = gogContext.getStore()
    if (lease?.active && lease === activeOwner) {
      return Promise.resolve().then(() => original.apply(receiver, args))
    }
    return new Promise((resolve, reject) => {
      const start = () => {
        const lease = { active: true }
        activeOwner = lease
        void gogContext.run(lease, async () => {
          try {
            resolve(await original.apply(receiver, args))
          } catch (error) {
            // Preserve the original rejection value, including non-Error values.
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            reject(error)
          } finally {
            lease.active = false
            activeOwner = undefined
            const next = refreshQueue.shift() ?? installQueue.shift()
            next?.()
          }
        })
      }
      if (!activeOwner) start()
      else if (refresh) refreshQueue.push(start)
      else installQueue.push(start)
    })
  }

  function install(managers: Managers, warn: (message: string) => void) {
    if (installed) {
      ready =
        installed.legendary === managers.legendary &&
        installed.gog === managers.gog &&
        installed.nile === managers.nile &&
        managers.legendary.runRunnerCommand === legendaryRunner &&
        managers.gog.runRunnerCommand === gogRunner &&
        managers.nile.runRunnerCommand === nileRunner &&
        managers.gog.refresh === gogRefresh &&
        managers.gog.getInstallInfo === gogInstallInfo
      if (!ready) warning(warn)
      return ready
    }
    const legendaryOriginal = managers.legendary?.runRunnerCommand
    const gogOriginal = managers.gog?.runRunnerCommand
    const nileOriginal = managers.nile?.runRunnerCommand
    const refreshOriginal = managers.gog?.refresh
    const installOriginal = managers.gog?.getInstallInfo
    if (
      typeof legendaryOriginal !== 'function' ||
      legendaryOriginal.length !== 2 ||
      typeof gogOriginal !== 'function' ||
      gogOriginal.length !== 2 ||
      typeof nileOriginal !== 'function' ||
      nileOriginal.length !== 2 ||
      typeof refreshOriginal !== 'function' ||
      refreshOriginal.length !== 0 ||
      typeof installOriginal !== 'function' ||
      installOriginal.length !== 1 ||
      typeof managers.legendary.getInstallInfo !== 'function' ||
      managers.legendary.getInstallInfo.length !== 2 ||
      typeof managers.nile.getInstallInfo !== 'function' ||
      managers.nile.getInstallInfo.length !== 1
    ) {
      warning(warn)
      return false
    }
    legendaryRunner = function (this: unknown, ...args: unknown[]) {
      return runRunner(legendaryOriginal as Method, this, args)
    }
    gogRunner = function (this: unknown, ...args: unknown[]) {
      return runRunner(gogOriginal as Method, this, args)
    }
    nileRunner = function (this: unknown, ...args: unknown[]) {
      return runRunner(nileOriginal as Method, this, args)
    }
    gogRefresh = function (this: unknown, ...args: unknown[]) {
      return gogTransaction(refreshOriginal as Method, this, args, true)
    }
    gogInstallInfo = function (this: unknown, ...args: unknown[]) {
      return gogTransaction(installOriginal as Method, this, args, false)
    }
    const legendaryDescriptor = Object.getOwnPropertyDescriptor(
      managers.legendary,
      'runRunnerCommand'
    )
    const gogDescriptor = Object.getOwnPropertyDescriptor(
      managers.gog,
      'runRunnerCommand'
    )
    const nileDescriptor = Object.getOwnPropertyDescriptor(
      managers.nile,
      'runRunnerCommand'
    )
    const refreshDescriptor = Object.getOwnPropertyDescriptor(
      managers.gog,
      'refresh'
    )
    const installDescriptor = Object.getOwnPropertyDescriptor(
      managers.gog,
      'getInstallInfo'
    )
    try {
      Object.defineProperty(managers.legendary, 'runRunnerCommand', {
        value: legendaryRunner,
        configurable: true,
        writable: true
      })
      Object.defineProperty(managers.gog, 'runRunnerCommand', {
        value: gogRunner,
        configurable: true,
        writable: true
      })
      Object.defineProperty(managers.nile, 'runRunnerCommand', {
        value: nileRunner,
        configurable: true,
        writable: true
      })
      Object.defineProperty(managers.gog, 'refresh', {
        value: gogRefresh,
        configurable: true,
        writable: true
      })
      Object.defineProperty(managers.gog, 'getInstallInfo', {
        value: gogInstallInfo,
        configurable: true,
        writable: true
      })
    } catch {
      restore(managers.legendary, 'runRunnerCommand', legendaryDescriptor)
      restore(managers.gog, 'runRunnerCommand', gogDescriptor)
      restore(managers.nile, 'runRunnerCommand', nileDescriptor)
      restore(managers.gog, 'refresh', refreshDescriptor)
      restore(managers.gog, 'getInstallInfo', installDescriptor)
      warning(warn)
      return false
    }
    installed = managers
    ready = true
    return true
  }
  let legendaryRunner: Method
  let gogRunner: Method
  let nileRunner: Method
  let gogRefresh: Method
  let gogInstallInfo: Method

  function warning(warn: (message: string) => void) {
    if (warned) return
    warned = true
    warn(
      '[nk] game details: CLI safety unavailable; background install info disabled'
    )
  }

  async function runBackgroundInstallInfo<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    if (!ready) throw new Error('Background install info safety unavailable')
    const lease = { active: true }
    return slowContext.run(lease, async () => {
      try {
        return await operation()
      } finally {
        lease.active = false
      }
    })
  }

  return { install, runBackgroundInstallInfo, isReady: () => ready }
}

function restore(
  manager: Manager,
  key: keyof Manager,
  descriptor?: PropertyDescriptor
) {
  if (descriptor) Object.defineProperty(manager, key, descriptor)
  else delete manager[key]
}

export const cliSafety = createCliSafety()
