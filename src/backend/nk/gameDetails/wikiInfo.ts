// nk: #5 - wiki game info hardening, applied from initNk() without editing
// upstream files:
// - concurrent getWikiGameInfo requests for the same game share one fetch
//   (the game page and its sub menu both ask for it on every visit);
// - an all-empty result (every source failed, e.g. a network blip) is
//   returned but never persisted, so it cannot hide real data until the
//   backend cache expires.
// Pure (dependencies injected) so it can be unit-tested.
import type { WikiInfo } from 'common/types'

/** One in-flight promise per key; the entry is dropped once it settles. */
export function createInflight<V>() {
  const pending = new Map<string, Promise<V>>()
  return {
    run(key: string, fetch: () => Promise<V>): Promise<V> {
      const running = pending.get(key)
      if (running) return running
      const promise = fetch().finally(() => {
        if (pending.get(key) === promise) pending.delete(key)
      })
      pending.set(key, promise)
      return promise
    },
    wait: async (key: string) => {
      await Promise.allSettled(pending.has(key) ? [pending.get(key)!] : [])
    },
    size: () => pending.size
  }
}

/** No source returned anything usable. */
export function isEmptyWikiInfo(info: Partial<WikiInfo> | null | undefined) {
  if (!info) return true
  return (
    !info.pcgamingwiki &&
    !info.howlongtobeat &&
    !info.applegamingwiki &&
    !info.steamInfo &&
    !info.gamesdb?.steamID
  )
}

interface SettableStore<V> {
  set: (key: string, value: V) => void
}

const GUARDED = Symbol.for('nk.gameDetails.wikiStoreGuarded')

/**
 * Patches `store.set` (instance level) so that values rejected by `skip` are
 * not written. Returns whether the patch was applied; a store with an
 * unexpected shape is left untouched with one warning.
 */
export function guardStoreSet<V>(
  store: SettableStore<V> | undefined,
  skip: (value: V) => boolean,
  warn: (msg: string) => void
): boolean {
  if (!store || typeof store.set !== 'function') {
    warn('[nk] wiki store guard: unexpected store shape, not applied')
    return false
  }
  const target = store as SettableStore<V> & { [GUARDED]?: true }
  if (target[GUARDED]) return true
  const original = store.set.bind(store)
  target.set = (key: string, value: V) => {
    if (skip(value)) return
    original(key, value)
  }
  target[GUARDED] = true
  return true
}

interface HandlerRegistry {
  removeHandler: (channel: string) => void
  // `never`: any handler signature (ipcMain's is `(event, ...args: any[])`)
  handle: (channel: string, handler: never) => void
}

/**
 * Replaces the IPC handler of `channel` (registered by upstream at import
 * time) with `handler`. Returns whether it was replaced.
 */
export function replaceIpcHandler(
  registry: Partial<HandlerRegistry> | undefined,
  channel: string,
  handler: (e: never, ...args: never[]) => unknown,
  warn: (msg: string) => void
): boolean {
  if (
    !registry ||
    typeof registry.removeHandler !== 'function' ||
    typeof registry.handle !== 'function'
  ) {
    warn(`[nk] cannot replace the ${channel} handler: unexpected ipcMain`)
    return false
  }
  registry.removeHandler(channel)
  registry.handle(channel, handler as never)
  return true
}
