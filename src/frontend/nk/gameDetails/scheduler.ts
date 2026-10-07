// nk: #5 - detail request lanes, shared by pages and speculative work.
export type DetailsLane =
  | 'local'
  | 'storeApi'
  | 'wiki'
  | 'cli'
  | 'installInfoBackground'
export type DetailsPriority = 0 | 1 | 2
export interface SchedulerState {
  playing: boolean
  launching: boolean
  downloading: boolean
  refreshing: boolean
  online: boolean
  enabled: boolean
}
export interface ScheduledDetails {
  id: string
  key: string
  lane: DetailsLane
  priority: DetailsPriority
  network: boolean
  slot?: string
  backgroundRequested?: boolean
  backgroundLane?: DetailsLane
}
interface PreparedDetails extends ScheduledDetails {
  backgroundRequested: boolean
  cancelled: boolean
}
interface Task extends ScheduledDetails {
  order: number
  backgroundRequested: boolean
  work: (lane: DetailsLane) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  promise: Promise<unknown>
}
export function createDetailsScheduler({
  isEnabled = (): boolean => true,
  now = () => Date.now(),
  setTimer = (work: () => void, delay: number) => setTimeout(work, delay),
  clearTimer = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer)
} = {}) {
  let state: SchedulerState = {
    playing: false,
    launching: false,
    downloading: false,
    refreshing: false,
    online: false,
    enabled: true
  }
  let order = 0
  const queued: Task[] = []
  const prepared = new Map<string, PreparedDetails>()
  const cancelled = new Set<string>()
  const running = new Map<string, Task>()
  const active = {
    local: 0,
    storeApi: 0,
    wiki: 0,
    cli: 0,
    installInfoBackground: 0
  }
  let storeApiStarted = -Infinity
  let wikiStarted = -Infinity
  let cliStarted = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined
  function blocked(task: Task) {
    if (state.playing || state.launching) return true
    if (task.priority > 0 && (!state.enabled || !isEnabled())) return true
    if (task.network && (!state.online || state.downloading)) return true
    if (
      state.refreshing &&
      (task.lane === 'wiki' || task.lane === 'installInfoBackground')
    )
      return true
    if (task.lane === 'local') return active.local >= 4
    if (task.lane === 'storeApi') return active.storeApi >= 2
    if (task.lane === 'wiki') return active.wiki >= 1
    return active.cli + active.installInfoBackground >= 1
  }
  function spacing(task: Task) {
    if (task.priority === 0) return 0
    if (task.lane === 'storeApi')
      return task.priority === 2 ? storeApiStarted + 250 - now() : 0
    if (task.lane === 'wiki')
      return wikiStarted + (task.priority === 2 ? 3000 : 1000) - now()
    if (task.lane === 'cli')
      return task.priority === 2 ? cliStarted + 1000 - now() : 0
    return 0
  }
  function pump() {
    if (timer !== undefined) {
      clearTimer(timer)
      timer = undefined
    }
    queued.sort(
      (a, b) =>
        a.priority - b.priority ||
        (a.priority === 1 ? b.order - a.order : a.order - b.order)
    )
    let delay = Infinity
    for (let index = 0; index < queued.length; ) {
      const task = queued[index]
      if (blocked(task)) {
        index++
        continue
      }
      if (
        task.lane === 'installInfoBackground' &&
        (running.size > 0 ||
          queued.some(
            (other) =>
              other !== task &&
              other.lane !== 'installInfoBackground' &&
              !blocked(other)
          ))
      ) {
        index++
        continue
      }
      const wait = spacing(task)
      if (wait > 0) {
        delay = Math.min(delay, wait)
        index++
        continue
      }
      queued.splice(index, 1)
      running.set(task.id, task)
      active[task.lane]++
      if (task.lane === 'storeApi') storeApiStarted = now()
      if (task.lane === 'wiki') wikiStarted = now()
      if (task.lane === 'cli') cliStarted = now()
      void Promise.resolve()
        .then(() => task.work(task.lane))
        .then(task.resolve, task.reject)
        .finally(() => {
          running.delete(task.id)
          active[task.lane]--
          pump()
        })
    }
    if (delay < Infinity) timer = setTimer(pump, Math.max(1, delay))
  }
  function promote(
    id: string,
    priority: DetailsPriority,
    backgroundLane?: DetailsLane
  ) {
    const queuedTask = queued.find((task) => task.id === id)
    const task = queuedTask ?? running.get(id) ?? prepared.get(id)
    if (!task) return
    if (priority === 2) {
      task.backgroundRequested = true
      task.backgroundLane = backgroundLane ?? task.backgroundLane ?? task.lane
    }
    if (priority <= task.priority) {
      task.priority = priority
      if (priority === 1 && 'order' in task) task.order = ++order
      const undispatched = queuedTask ?? prepared.get(id)
      if (
        undispatched &&
        priority < 2 &&
        undispatched.lane === 'installInfoBackground'
      )
        undispatched.lane = 'cli'
      pump()
    }
  }
  return {
    prepare(request: Omit<PreparedDetails, 'cancelled'>) {
      cancelled.delete(request.id)
      const intent = {
        ...request,
        backgroundLane:
          request.backgroundLane ??
          (request.priority === 2 ? request.lane : undefined),
        cancelled: false
      }
      prepared.set(request.id, intent)
      return intent
    },
    release(id: string) {
      prepared.delete(id)
      cancelled.delete(id)
    },
    isCancelled: (id: string) => cancelled.has(id),
    enqueue<T>(
      request: ScheduledDetails,
      work: (lane: DetailsLane) => Promise<T>
    ): Promise<T> {
      const existing =
        queued.find((task) => task.id === request.id) ?? running.get(request.id)
      if (existing) {
        if (request.priority === 2) existing.backgroundRequested = true
        promote(request.id, request.priority, request.backgroundLane)
        return existing.promise as Promise<T>
      }
      let resolve!: (value: unknown) => void
      let reject!: (error: unknown) => void
      const promise = new Promise<unknown>((yes, no) => {
        resolve = yes
        reject = no
      })
      cancelled.delete(request.id)
      const intent = prepared.get(request.id)
      prepared.delete(request.id)
      const priority = intent?.priority ?? request.priority
      queued.push({
        ...request,
        priority,
        lane:
          priority < 2 &&
          (intent?.lane ?? request.lane) === 'installInfoBackground'
            ? 'cli'
            : (intent?.lane ?? request.lane),
        backgroundLane:
          intent?.backgroundLane ??
          request.backgroundLane ??
          (request.priority === 2 ? request.lane : undefined),
        order: ++order,
        backgroundRequested:
          intent?.backgroundRequested ||
          request.backgroundRequested ||
          request.priority === 2,
        work,
        resolve,
        reject,
        promise
      })
      pump()
      return promise as Promise<T>
    },
    promote,
    cancel(
      key: string,
      cliAndWikiOnly = false,
      scope?: 'install' | 'achievements'
    ) {
      for (const task of prepared.values()) {
        if (task.key !== key || task.priority === 0) continue
        if (scope === 'achievements' && task.slot !== 'achievements') continue
        if (
          scope === 'install' &&
          task.slot !== 'launchOptions' &&
          !task.slot?.startsWith('installInfo@')
        )
          continue
        if (
          cliAndWikiOnly &&
          task.lane !== 'wiki' &&
          task.lane !== 'cli' &&
          task.lane !== 'installInfoBackground'
        )
          continue
        if (cliAndWikiOnly && task.backgroundRequested) {
          task.priority = 2
          task.lane = task.backgroundLane ?? task.lane
        } else {
          task.cancelled = true
          cancelled.add(task.id)
        }
      }
      for (let index = queued.length - 1; index >= 0; index--) {
        const task = queued[index]
        if (
          task.key === key &&
          task.priority > 0 &&
          (!scope ||
            (scope === 'achievements' && task.slot === 'achievements') ||
            (scope === 'install' &&
              (task.slot === 'launchOptions' ||
                task.slot?.startsWith('installInfo@')))) &&
          (!cliAndWikiOnly ||
            task.lane === 'wiki' ||
            task.lane === 'cli' ||
            task.lane === 'installInfoBackground')
        ) {
          if (cliAndWikiOnly && task.backgroundRequested) {
            task.priority = 2
            task.lane = task.backgroundLane ?? task.lane
            continue
          }
          queued.splice(index, 1)
          cancelled.add(task.id)
          const error = new Error('Detail request cancelled')
          error.name = 'DetailsRequestCancelled'
          task.reject(error)
        }
      }
      pump()
    },
    downgrade(key: string) {
      for (const task of prepared.values())
        if (task.key === key && task.priority === 1) {
          task.priority = 2
          task.lane = task.backgroundLane ?? task.lane
        }
      for (const task of queued)
        if (task.key === key && task.priority === 1) {
          task.priority = 2
          task.lane = task.backgroundLane ?? task.lane
        }
      pump()
    },
    update(next: Partial<SchedulerState>) {
      state = { ...state, ...next }
      pump()
    },
    pending: () => queued.length + running.size,
    dispose() {
      if (timer !== undefined) clearTimer(timer)
      timer = undefined
      state.enabled = false
    }
  }
}
export type DetailsScheduler = ReturnType<typeof createDetailsScheduler>
