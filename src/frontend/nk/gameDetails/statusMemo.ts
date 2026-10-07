// nk: #5 - last computed status per game (hasStatus), so a game page opened
// from a library card shows the right status-dependent UI on its first
// frame (no Install -> Play flip). A plain Map on purpose: every library
// card writes to it at startup, and it is never persisted (status is always
// recomputed).
import type { Status } from 'common/types'

export interface RememberedStatus {
  status?: Status
  folder?: string
  statusContext?: string
}

const memo = new Map<string, RememberedStatus>()

export function peekStatus(appName: string): RememberedStatus | undefined {
  return memo.get(appName)
}

export function rememberStatus(appName: string, value: RememberedStatus) {
  if (!value.status) return
  const { status, folder, statusContext } = value
  memo.set(appName, { status, folder, statusContext })
}

export function forgetStatus(appName: string) {
  memo.delete(appName)
}

/** Wraps a status setter so that every value set is also remembered. */
export function rememberingStatus<T extends RememberedStatus>(
  appName: string,
  set: (value: T) => void
) {
  return (value: T) => {
    rememberStatus(appName, value)
    set(value)
  }
}

const subscribers = new Map<string, Set<() => void>>()

export function subscribeStatus(appName: string, notify: () => void) {
  let listeners = subscribers.get(appName)
  if (!listeners) subscribers.set(appName, (listeners = new Set()))
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

export function statusRefreshed(appName: string) {
  for (const notify of subscribers.get(appName) ?? []) notify()
}
