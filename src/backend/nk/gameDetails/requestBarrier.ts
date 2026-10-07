// nk: #5 - finish older detail requests before deleting their backend
// caches; new requests for that game wait until deletion finishes.
export function createRequestBarrier() {
  const pending = new Map<string, Set<Promise<unknown>>>()
  const holds = new Map<string, Promise<unknown>>()

  async function run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const hold = holds.get(key)
    if (hold) await hold
    const promise = work()
    let requests = pending.get(key)
    if (!requests) pending.set(key, (requests = new Set()))
    requests.add(promise)
    try {
      return await promise
    } finally {
      requests.delete(promise)
      if (!requests.size) pending.delete(key)
    }
  }

  async function invalidate<T>(
    key: string,
    work: () => Promise<T>
  ): Promise<T> {
    const previous = holds.get(key)
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    holds.set(key, hold)
    try {
      if (previous) await previous
      await Promise.allSettled([...(pending.get(key) ?? [])])
      return await work()
    } finally {
      if (holds.get(key) === hold) holds.delete(key)
      release()
    }
  }

  return { run, invalidate }
}

interface HandlerRegistry {
  _invokeHandlers?: Map<string, (...args: unknown[]) => unknown>
  removeHandler: (channel: string) => void
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => void
}

/** Keep upstream handlers intact while tracking their request lifetimes. */
export function trackDetailsHandler(
  registry: HandlerRegistry,
  channel: string,
  barrier: ReturnType<typeof createRequestBarrier>,
  warn: (message: string) => void
) {
  const original =
    registry._invokeHandlers instanceof Map
      ? registry._invokeHandlers.get(channel)
      : undefined
  if (typeof original !== 'function') {
    warn(
      `[nk] game details: cannot track ${channel}: unexpected handler registry`
    )
    return false
  }
  registry.removeHandler(channel)
  registry.handle(channel, (event, appName, runner, ...args) =>
    barrier.run(`${String(runner)}:${String(appName)}`, () =>
      Promise.resolve(original(event, appName, runner, ...args))
    )
  )
  return true
}

export const requestBarrier = createRequestBarrier()
