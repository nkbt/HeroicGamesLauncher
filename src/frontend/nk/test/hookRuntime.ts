// nk: #4 - a minimal hook runtime for node tests of fork hooks (no DOM, no
// renderer). A test replaces `react` with it:
//
//   jest.mock('react', () => jest.requireActual('frontend/nk/test/hookRuntime').react)
//
// and renders the hook under test with `createHookRoot`. It implements only
// what the tested hooks use: useState, useRef, useMemo, useCallback,
// useEffect, useLayoutEffect, useContext and createContext. Effects run right
// after each render; a state update marks the root dirty and `render()` /
// `settle()` re-render until it is clean, like React would.

interface HookSlot {
  initialized?: boolean
  value?: unknown
  deps?: readonly unknown[]
  cleanup?: (() => void) | void
  set?: (update: unknown) => void
}

interface TestContext<T> {
  defaultValue: T
  Provider: () => null
  Consumer: () => null
}

interface Root {
  slots: HookSlot[]
  index: number
  effects: Array<() => void>
  dirty: boolean
  contexts: Map<TestContext<unknown>, unknown>
}

let current: Root | null = null

function nextSlot(): [Root, HookSlot] {
  if (!current) throw new Error('hook called outside createHookRoot().render')
  const root = current
  const index = root.index++
  root.slots[index] ??= {}
  return [root, root.slots[index]]
}

function depsChanged(prev?: readonly unknown[], next?: readonly unknown[]) {
  if (!prev || !next || prev.length !== next.length) return true
  return next.some((dep, i) => !Object.is(dep, prev[i]))
}

function useState<S>(initial: S | (() => S)) {
  const [root, slot] = nextSlot()
  if (!slot.initialized) {
    slot.initialized = true
    slot.value =
      typeof initial === 'function' ? (initial as () => S)() : initial
    slot.set = (update: unknown) => {
      const next =
        typeof update === 'function'
          ? (update as (prev: unknown) => unknown)(slot.value)
          : update
      if (Object.is(next, slot.value)) return
      slot.value = next
      root.dirty = true
    }
  }
  return [slot.value as S, slot.set as (update: S | ((prev: S) => S)) => void]
}

function useRef<T>(initial: T) {
  const [, slot] = nextSlot()
  if (!slot.initialized) {
    slot.initialized = true
    slot.value = { current: initial }
  }
  return slot.value as { current: T }
}

function useMemo<T>(factory: () => T, deps: readonly unknown[]) {
  const [, slot] = nextSlot()
  if (!slot.initialized || depsChanged(slot.deps, deps)) {
    slot.initialized = true
    slot.value = factory()
    slot.deps = deps
  }
  return slot.value as T
}

function useCallback<T>(callback: T, deps: readonly unknown[]) {
  const [, slot] = nextSlot()
  if (!slot.initialized || depsChanged(slot.deps, deps)) {
    slot.initialized = true
    slot.value = callback
    slot.deps = deps
  }
  return slot.value as T
}

function useEffect(effect: () => (() => void) | void, deps?: unknown[]) {
  const [root, slot] = nextSlot()
  if (slot.initialized && !depsChanged(slot.deps, deps)) return
  slot.initialized = true
  slot.deps = deps
  root.effects.push(() => {
    if (slot.cleanup) slot.cleanup()
    slot.cleanup = effect()
  })
}

function createContext<T>(defaultValue: T): TestContext<T> {
  return { defaultValue, Provider: () => null, Consumer: () => null }
}

function useContext<T>(context: TestContext<T>): T {
  if (!current) throw new Error('hook called outside createHookRoot().render')
  return current.contexts.has(context as TestContext<unknown>)
    ? (current.contexts.get(context as TestContext<unknown>) as T)
    : context.defaultValue
}

const api = {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect: useEffect,
  createContext,
  useContext
}

/** Module stand-in for `react` (default and named imports). */
export const react = { ...api, default: api }

const MAX_PASSES = 50

export function createHookRoot<P, R>(hook: (props: P) => R) {
  const root: Root = {
    slots: [],
    index: 0,
    effects: [],
    dirty: false,
    contexts: new Map()
  }
  const result = { current: undefined as R }
  let lastProps: P

  function render(props: P = lastProps) {
    lastProps = props
    let passes = 0
    do {
      if (++passes > MAX_PASSES) throw new Error('render loop')
      root.dirty = false
      root.index = 0
      current = root
      try {
        result.current = hook(props)
      } finally {
        current = null
      }
      for (const effect of root.effects.splice(0)) effect()
    } while (root.dirty)
  }

  return {
    result,
    render,
    /** value returned by `useContext(context)` from the next render on */
    provide<T>(context: unknown, value: T) {
      root.contexts.set(context as TestContext<unknown>, value)
    },
    /** let pending promises settle, then re-render if state changed */
    async settle() {
      for (let i = 0; i < 20; i++) await Promise.resolve()
      if (root.dirty) render()
    },
    unmount() {
      for (const slot of root.slots) {
        if (slot?.cleanup) slot.cleanup()
      }
    }
  }
}
