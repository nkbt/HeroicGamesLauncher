// nk: #5 - the game details store. Module-level, so it survives route
// changes and unmounts.
// - Reads (`getEntry`/`getSlot`) always see every write immediately.
// - Subscribers (the zustand `state`) are notified in batches: all writes
//   made before the next notification are published with one `setState`,
//   so a burst of writes re-renders an open page once.
// - Persistence is write-behind: dirty keys are written in one batch per
//   flush window. Hydrated once at startup; hydration never overwrites what
//   was written (or dropped) in this session before it finished.
import { createStore } from 'zustand/vanilla'
import { waitForPersistence, type DetailsPersistence } from './persistence'
import { listGroupOf } from './types'
import type {
  DetailsKey,
  Entries,
  GameDetailsEntry,
  Slot,
  SlotId
} from './types'

export interface GameDetailsState {
  entries: Entries
  hydrated: boolean
}

export interface StoreOptions {
  flushDelayMs?: number
  /** schedules the next subscriber notification */
  scheduleNotify?: (notify: () => void) => void
  warn?: (...args: unknown[]) => void
}

export type GameDetailsStore = ReturnType<typeof createGameDetailsStore>

type SlotFilter = (slot: SlotId) => boolean

export function createGameDetailsStore(
  persistence: DetailsPersistence,
  {
    flushDelayMs = 500,
    scheduleNotify = (notify) => setTimeout(notify, 0),
    warn = console.warn
  }: StoreOptions = {}
) {
  const state = createStore<GameDetailsState>(() => ({
    entries: {},
    hydrated: false
  }))
  let entries: Entries = {}
  let hydrated = false
  let ready!: () => void
  const hydrationReady = new Promise<void>((resolve) => {
    ready = resolve
  })
  let background = false
  let backgroundTimer: ReturnType<typeof setTimeout> | null = null
  let lastNotification = -Infinity
  let notifyScheduled = false
  const pendingKeys = new Set<DetailsKey>()
  // slots dropped before hydration finished must not come back from disk
  const droppedBeforeHydration = new Map<DetailsKey, SlotFilter[] | 'all'>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let flushing: Promise<void> = Promise.resolve()
  const writes = new Set<AbortController>()
  let generation = 0
  let resetting = false
  const versions = new Map<DetailsKey, number>()
  let dropPersistedSettings = false

  /** Publishes the current entries to subscribers now. */
  function notify() {
    notifyScheduled = false
    lastNotification = Date.now()
    if (state.getState().entries !== entries || !state.getState().hydrated) {
      state.setState({ entries, hydrated })
    }
  }

  function scheduleNotification() {
    if (!background && backgroundTimer !== null) {
      clearTimeout(backgroundTimer)
      backgroundTimer = null
    }
    if (background && !notifyScheduled) {
      if (backgroundTimer === null)
        backgroundTimer = setTimeout(
          () => {
            backgroundTimer = null
            notify()
          },
          Math.max(0, 250 - (Date.now() - lastNotification))
        )
      return
    }
    if (notifyScheduled) return
    notifyScheduled = true
    scheduleNotify(notify)
  }

  function scheduleFlush(key: DetailsKey) {
    pendingKeys.add(key)
    if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null
        void flush()
      }, flushDelayMs)
    }
  }

  /** Writes every pending key in one batch. */
  function flush(): Promise<void> {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    const keys = [...pendingKeys]
    pendingKeys.clear()
    if (keys.length === 0) return flushing
    const puts: Array<[DetailsKey, GameDetailsEntry]> = []
    const deletes: DetailsKey[] = []
    for (const key of keys) {
      const entry = entries[key]
      if (entry) puts.push([key, entry])
      else deletes.push(key)
    }
    const controller = new AbortController()
    writes.add(controller)
    flushing = flushing
      .then(async () => {
        if (controller.signal.aborted) return
        await waitForPersistence(
          persistence.putMany(puts, controller.signal),
          controller.signal
        )
        if (controller.signal.aborted) return
        await waitForPersistence(
          persistence.deleteMany(deletes, controller.signal),
          controller.signal
        )
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          warn('[nk] game details: persisting failed', error)
      })
      .finally(() => {
        writes.delete(controller)
      })
    return flushing
  }

  function getEntry(key: DetailsKey): GameDetailsEntry | undefined {
    return entries[key]
  }

  function getSlot<T>(key: DetailsKey, slot: SlotId): Slot<T> | undefined {
    return entries[key]?.slots[slot] as Slot<T> | undefined
  }

  function writeEntries(changes: Array<[DetailsKey, GameDetailsEntry | null]>) {
    if (resetting || changes.length === 0) return
    entries = { ...entries }
    for (const [key, entry] of changes) {
      if (entry) entries[key] = entry
      else delete entries[key]
      scheduleFlush(key)
    }
    scheduleNotification()
  }

  function rememberDrop(key: DetailsKey, filter: SlotFilter | 'all') {
    if (hydrated) return
    const known = droppedBeforeHydration.get(key)
    if (filter === 'all' || known === 'all') {
      droppedBeforeHydration.set(key, 'all')
      return
    }
    droppedBeforeHydration.set(key, [...(known ?? []), filter])
  }

  /** Stores `data` (identity kept: callers get back the stored object). */
  function setSlot<T>(
    key: DetailsKey,
    slot: SlotId,
    data: T | null | undefined,
    accountId?: string
  ): Slot<T> {
    const prev = entries[key]
    const value: Slot<T> = {
      data: data ?? null,
      ...(accountId ? { accountId } : {})
    }
    writeEntries([[key, { ...prev, slots: { ...prev?.slots, [slot]: value } }]])
    return value
  }

  /** Updates an entry's bookkeeping (list signature, counters). */
  function patchEntry(
    key: DetailsKey,
    patch: (entry: GameDetailsEntry) => GameDetailsEntry
  ) {
    const prev = entries[key] ?? { slots: {} }
    const next = patch(prev)
    if (next !== prev) writeEntries([[key, next]])
  }

  /** Drops the slots matched by `filter` from the given keys. */
  function dropSlots(keys: DetailsKey[], filter: SlotFilter) {
    const changes: Array<[DetailsKey, GameDetailsEntry | null]> = []
    for (const key of keys) {
      rememberDrop(key, filter)
      const prev = entries[key]
      if (!prev) continue
      const ids = (Object.keys(prev.slots) as SlotId[]).filter(filter)
      if (ids.length === 0) continue
      const slots = { ...prev.slots }
      for (const id of ids) delete slots[id]
      changes.push([key, { ...prev, slots }])
    }
    writeEntries(changes)
  }

  function removeKeys(keys: DetailsKey[]) {
    for (const key of keys) {
      rememberDrop(key, 'all')
      versions.set(key, (versions.get(key) ?? 0) + 1)
    }
    writeEntries(
      keys
        .filter((key) => entries[key])
        .map((key): [DetailsKey, null] => [key, null])
    )
  }

  async function clearAll(signal?: AbortSignal) {
    generation++
    pendingKeys.clear()
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    entries = {}
    notify()
    try {
      await waitForPersistence(flushing, signal)
      if (signal?.aborted) return
      await waitForPersistence(persistence.clear(signal), signal)
    } catch (error) {
      warn('[nk] game details: clearing failed', error)
      throw error
    }
  }

  function mergeEntry(
    key: DetailsKey,
    persisted: GameDetailsEntry | undefined,
    live: GameDetailsEntry | undefined
  ): GameDetailsEntry | null {
    const dropped = droppedBeforeHydration.get(key) ?? []
    if (dropped === 'all' || !persisted) return live ?? null
    const slots = { ...persisted.slots }
    if (dropPersistedSettings && key.startsWith('settings:'))
      delete slots.settings
    for (const id of Object.keys(slots) as SlotId[]) {
      if (dropped.some((filter) => filter(id))) delete slots[id]
    }
    const listSig = { ...persisted.listSig, ...live?.listSig }
    for (const id of Object.keys(slots) as SlotId[]) {
      const group = listGroupOf(id)
      if (
        group &&
        !live?.slots[id] &&
        live?.listSig?.[group] !== undefined &&
        persisted.listSig?.[group] !== live.listSig[group]
      ) {
        // Retained data from another list version has no shared provenance.
        delete listSig[group]
      }
    }
    Object.assign(slots, live?.slots)
    return {
      ...persisted,
      ...live,
      listSig,
      slots
    }
  }

  async function hydrate() {
    const started = generation
    let loaded: Entries = {}
    try {
      loaded = await persistence.loadAll()
    } catch (error) {
      warn('[nk] game details: loading the cache failed', error)
    }
    if (resetting || started !== generation) loaded = {} // cleared meanwhile
    const live = entries
    const merged: Entries = {}
    for (const key of new Set([...Object.keys(loaded), ...Object.keys(live)])) {
      const entry = mergeEntry(key, loaded[key], live[key])
      if (entry) merged[key] = entry
    }
    entries = merged
    hydrated = true
    ready()
    // keys changed while loading are written back in their merged form
    for (const key of Object.keys(live)) scheduleFlush(key)
    for (const key of droppedBeforeHydration.keys()) scheduleFlush(key)
    if (dropPersistedSettings) {
      for (const key of Object.keys(loaded)) {
        if (key.startsWith('settings:')) scheduleFlush(key)
      }
    }
    droppedBeforeHydration.clear()
    dropPersistedSettings = false
    notify()
  }

  return {
    state,
    batchUpdates<T>(work: () => T, speculative: boolean) {
      const previous = background
      background = speculative
      try {
        return work()
      } finally {
        background = previous
      }
    },
    getEntry,
    getSlot,
    setSlot,
    patchEntry,
    dropSlots,
    removeKeys,
    version: (key: DetailsKey) => versions.get(key) ?? 0,
    dropAllSettings: () => {
      if (!hydrated) dropPersistedSettings = true
      dropSlots(
        Object.keys(entries).filter((key) => key.startsWith('settings:')),
        (slot) => slot === 'settings'
      )
    },
    clearAll,
    resumeAfterReset: () => {
      if (resetting) {
        for (const controller of writes) controller.abort()
        writes.clear()
        flushing = Promise.resolve()
      }
      resetting = false
    },
    prepareReset: async (signal: AbortSignal) => {
      resetting = true
      await clearAll(signal)
    },
    hydrate,
    hydrationReady,
    flush,
    notify,
    isHydrated: () => hydrated,
    keys: () => Object.keys(entries),
    generation: () => generation
  }
}
