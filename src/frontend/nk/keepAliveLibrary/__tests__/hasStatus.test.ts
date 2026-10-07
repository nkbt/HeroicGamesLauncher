jest.mock('frontend/nk/gameDetails/account', () => ({
  getAccountId: () => undefined
}))

// The kept-alive Library never remounts its cards, so `hasStatus` must follow
// the current `gameInfo` prop instead of the value it was first called with.
// jsdom is not available, so the hook runs under a tiny single-component
// stand-in for React's useState / useEffect / useContext.
import { GameInfo, GameStatus } from 'common/types'

type Slot = { value?: unknown; deps?: unknown[] }

const harness = {
  slots: [] as Slot[],
  index: 0,
  effects: [] as (() => void)[],
  dirty: false,
  context: {} as unknown
}

jest.mock('react', () => {
  const useState = (init: unknown) => {
    const i = harness.index++
    if (!harness.slots[i]) harness.slots[i] = { value: init }
    const slot = harness.slots[i]
    const set = (next: unknown) => {
      const value =
        typeof next === 'function'
          ? (next as (prev: unknown) => unknown)(slot.value)
          : next
      if (!Object.is(value, slot.value)) {
        slot.value = value
        harness.dirty = true
      }
    }
    return [slot.value, set]
  }
  const useEffect = (effect: () => void, deps?: unknown[]) => {
    const i = harness.index++
    const prev = harness.slots[i]
    const changed =
      !prev ||
      !deps ||
      !prev.deps ||
      deps.some((dep, n) => !Object.is(dep, prev.deps?.[n]))
    harness.slots[i] = { deps }
    if (changed) harness.effects.push(effect)
  }
  const useContext = () => harness.context
  const hooks = { useState, useEffect, useContext }
  return { __esModule: true, default: hooks, ...hooks }
})

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

jest.mock('frontend/state/ContextProvider', () => ({
  __esModule: true,
  default: {}
}))

jest.mock('frontend/hooks/hasProgress', () => {
  const progress = { percent: 0 }
  return { hasProgress: () => [progress, progress] }
})

jest.mock('frontend/hooks/constants', () => ({
  getStatusLabel: ({ status }: { status: string }) => `label:${status}`,
  handleNonAvailableGames: () => Promise.resolve(true)
}))

import { hasStatus } from 'frontend/hooks/hasStatus'

const flush = async () => new Promise((resolve) => setTimeout(resolve, 0))

const library = { library: [] }

function setLibraryStatus(libraryStatus: GameStatus[]) {
  harness.context = { libraryStatus, epic: library, gog: library }
}

// Renders like React would: run effects after each render, re-render while
// state changed, and let the async status check settle in between.
async function render(gameInfo: GameInfo) {
  for (let pass = 0; pass < 10; pass++) {
    harness.index = 0
    harness.dirty = false
    const result = hasStatus(gameInfo)
    harness.effects.splice(0).forEach((effect) => effect())
    await flush()
    if (!harness.dirty) return result
  }
  throw new Error('hasStatus did not settle')
}

const game = (is_installed: boolean) =>
  ({
    app_name: 'game-a',
    runner: 'legendary',
    title: 'Test Game',
    is_installed
  }) as GameInfo

describe('nk/keepAliveLibrary hasStatus on a retained card', () => {
  beforeEach(() => {
    harness.slots = []
    harness.index = 0
    harness.effects = []
    harness.dirty = false
    setLibraryStatus([])
  })

  test('install finishing while the Library is hidden shows installed', async () => {
    expect((await render(game(false))).status).toBe('notInstalled')

    // installed from the GamePage; the hidden card stays mounted
    setLibraryStatus([{ appName: 'game-a', status: 'installing' }])
    expect((await render(game(false))).status).toBe('installing')
    setLibraryStatus([{ appName: 'game-a', status: 'done' }])
    await render(game(false))
    // the card then receives the refreshed gameInfo
    const result = await render(game(true))

    expect(result.status).toBe('installed')
    expect(result.label).toBe('label:installed')
  })

  test('uninstall finishing while the Library is hidden shows not installed', async () => {
    expect((await render(game(true))).status).toBe('installed')

    setLibraryStatus([{ appName: 'game-a', status: 'uninstalling' }])
    expect((await render(game(true))).status).toBe('uninstalling')
    setLibraryStatus([{ appName: 'game-a', status: 'done' }])
    await render(game(true))
    const result = await render(game(false))

    expect(result.status).toBe('notInstalled')
    expect(result.label).toBe('label:notInstalled')
  })
})
