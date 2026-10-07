import type { ConnectivityStatus, GameInfo } from 'common/types'
import { createHookRoot } from 'frontend/nk/test/hookRuntime'
import ContextProvider from 'frontend/state/ContextProvider'
import { useLibraryImagePrefetch } from 'frontend/nk/libraryImages/useLibraryImagePrefetch'

jest.mock(
  'react',
  () =>
    jest.requireActual<typeof import('frontend/nk/test/hookRuntime')>(
      'frontend/nk/test/hookRuntime'
    ).react
)

const cover = (app_name: string) => `https://img.example.test/${app_name}.jpg`

function game(app_name: string, art_square = cover(app_name)): GameInfo {
  return {
    app_name,
    runner: 'gog',
    title: 'Test Game',
    art_square,
    art_cover: '',
    install: {},
    is_installed: false,
    canRunOffline: false
  } as GameInfo
}

function contextWith(library: GameInfo[], status: ConnectivityStatus) {
  return {
    connectivity: { status, retryIn: 0 },
    epic: { library: [] },
    gog: { library },
    amazon: { library: [] },
    zoom: { library: [] },
    sideloadedLibrary: [],
    favouriteGames: { list: [] }
  }
}

function setup(library: GameInfo[]) {
  const prefetch = jest.fn(async (urls: string[], tier?: string) =>
    Promise.resolve({ total: urls.length, alreadyCached: 0, queued: 0, tier })
  )
  Object.assign(globalThis, {
    window: { api: { prefetchLibraryImages: prefetch } }
  })
  const view = createHookRoot(() => useLibraryImagePrefetch())
  view.provide(ContextProvider, contextWith(library, 'online'))
  view.render(undefined)
  const refresh = (next: GameInfo[], status: ConnectivityStatus = 'online') => {
    view.provide(ContextProvider, contextWith(next, status))
    view.render()
    jest.runOnlyPendingTimers()
  }
  jest.runOnlyPendingTimers()
  return { prefetch, refresh }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('useLibraryImagePrefetch', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  test('the first run sends the whole list, a repeated list sends nothing', () => {
    const { prefetch, refresh } = setup([game('game-a'), game('game-b')])
    expect(prefetch).toHaveBeenCalledTimes(1)
    expect(prefetch).toHaveBeenCalledWith(
      [cover('game-a'), cover('game-b')],
      'card'
    )

    refresh([game('game-a'), game('game-b')]) // new objects, same URLs
    expect(prefetch).toHaveBeenCalledTimes(1)
  })

  test('one changed cover sends only its new URL', () => {
    const { prefetch, refresh } = setup([game('game-a'), game('game-b')])
    refresh([
      game('game-a'),
      game('game-b', 'https://img.example.test/new.jpg')
    ])
    expect(prefetch).toHaveBeenCalledTimes(2)
    expect(prefetch).toHaveBeenLastCalledWith(
      ['https://img.example.test/new.jpg'],
      'card'
    )
  })

  test('a reorder alone sends nothing', () => {
    const { prefetch, refresh } = setup([game('game-a'), game('game-b')])
    refresh([game('game-b'), game('game-a')])
    expect(prefetch).toHaveBeenCalledTimes(1)
  })

  test('URLs of a pending request are not sent again', () => {
    const { prefetch, refresh } = setup([game('game-a')])
    prefetch.mockImplementation(async () => new Promise(() => undefined))
    refresh([game('game-a'), game('game-b')])
    refresh([game('game-a'), game('game-b'), game('game-c')])
    expect(prefetch.mock.calls.map(([urls]) => urls)).toEqual([
      [cover('game-a')],
      [cover('game-b')],
      [cover('game-c')]
    ])
  })

  test('URLs of a failed request are sent again with the next change', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { prefetch, refresh } = setup([game('game-a')])
    prefetch.mockRejectedValueOnce(new Error('ipc'))
    refresh([game('game-a'), game('game-b')])
    await flush()
    refresh([game('game-a'), game('game-b'), game('game-c')])
    expect(prefetch).toHaveBeenLastCalledWith(
      [cover('game-b'), cover('game-c')],
      'card'
    )
    warn.mockRestore()
  })

  test('nothing is sent while offline; reconnecting sends the complete list', () => {
    const { prefetch, refresh } = setup([game('game-a')])
    prefetch.mockClear()
    refresh([game('game-a')], 'offline')
    refresh([game('game-a'), game('game-b')], 'offline')
    refresh([game('game-a'), game('game-b'), game('game-c')], 'offline')
    expect(prefetch).not.toHaveBeenCalled()

    refresh([game('game-a'), game('game-b'), game('game-c')], 'online')
    expect(prefetch).toHaveBeenCalledTimes(1)
    expect(prefetch).toHaveBeenCalledWith(
      [cover('game-a'), cover('game-b'), cover('game-c')],
      'card'
    )
  })

  test('batches deferred by an already offline backend go out again on reconnect', () => {
    const { prefetch, refresh } = setup([game('game-a')])
    // the backend is offline, the renderer has not seen it yet: [B] is
    // deferred there, then replaced by [C]
    refresh([game('game-a'), game('game-b')])
    refresh([game('game-a'), game('game-b'), game('game-c')])
    expect(prefetch.mock.calls.map(([urls]) => urls)).toEqual([
      [cover('game-a')],
      [cover('game-b')],
      [cover('game-c')]
    ])
    // the renderer sees the disconnect, then the reconnect
    refresh([game('game-a'), game('game-b'), game('game-c')], 'offline')
    refresh([game('game-a'), game('game-b'), game('game-c')], 'online')
    expect(prefetch).toHaveBeenCalledTimes(4)
    expect(prefetch).toHaveBeenLastCalledWith(
      [cover('game-a'), cover('game-b'), cover('game-c')],
      'card'
    )
    // back to deltas after the complete send
    refresh([game('game-a'), game('game-b'), game('game-c'), game('game-d')])
    expect(prefetch).toHaveBeenLastCalledWith([cover('game-d')], 'card')
  })
})
