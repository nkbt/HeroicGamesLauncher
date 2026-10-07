jest.mock('frontend/nk/gameDetails/account', () => ({
  getAccountId: () => undefined
}))

import type { GameInfo } from 'common/types'
import { createHookRoot } from 'frontend/nk/test/hookRuntime'
import ContextProvider from 'frontend/state/ContextProvider'
import { hasStatus } from 'frontend/hooks/hasStatus'

jest.mock(
  'react',
  () =>
    jest.requireActual<typeof import('frontend/nk/test/hookRuntime')>(
      'frontend/nk/test/hookRuntime'
    ).react
)

const mockTranslation = { t: (key: string) => key }
jest.mock('react-i18next', () => ({
  useTranslation: () => mockTranslation
}))

const mockProgress = [{ percent: 0 }]
jest.mock('frontend/hooks/hasProgress', () => ({
  hasProgress: () => mockProgress
}))

jest.mock('frontend/hooks/constants', () => ({
  getStatusLabel: ({
    status,
    runner,
    size,
    t
  }: {
    status: string
    runner: string
    size?: string
    t: (key: string) => string
  }) => [`${runner}/${t(status)}`, size].filter(Boolean).join(' '),
  handleNonAvailableGames: async () => Promise.resolve(true)
}))

function game(extra: Partial<GameInfo> = {}): GameInfo {
  return {
    app_name: 'game-a',
    runner: 'nile',
    title: 'Test Game',
    art_square: '',
    art_cover: '',
    install: {},
    is_installed: true,
    canRunOffline: false,
    ...extra
  } as GameInfo
}

// the store arrays keep their identity: the Epic and GOG lists did not change
const context = {
  libraryStatus: [],
  epic: { library: [] },
  gog: { library: [] }
}

async function setup(gameInfo: GameInfo, gameSize?: string) {
  const view = createHookRoot(
    (props: { gameInfo: GameInfo; gameSize?: string }) =>
      hasStatus(props.gameInfo, props.gameSize)
  )
  view.provide(ContextProvider, context)
  view.render({ gameInfo, gameSize })
  await view.settle()
  return view
}

describe('hasStatus (status inputs)', () => {
  test('an install size change alone updates the label', async () => {
    const view = await setup(game(), '1 GB')
    expect(view.result.current.label).toBe('nile/installed 1 GB')

    view.render({ gameInfo: game(), gameSize: '2 GB' })
    await view.settle()
    expect(view.result.current.label).toBe('nile/installed 2 GB')
  })

  test('managed-game flag changes update the status', async () => {
    const view = await setup(game(), '1 GB')
    expect(view.result.current.status).toBe('installed')

    const origin = { thirdPartyManagedApp: 'Origin' }
    view.render({ gameInfo: game(origin) })
    await view.settle()
    expect(view.result.current.status).toBe('notSupportedGame')

    view.render({ gameInfo: game({ ...origin, isUbisoftManaged: true }) })
    await view.settle()
    expect(view.result.current.status).toBe('notInstalled')

    view.render({ gameInfo: game(origin) })
    await view.settle()
    expect(view.result.current.status).toBe('notSupportedGame')

    view.render({ gameInfo: game({ ...origin, isEAManaged: true }) })
    await view.settle()
    expect(view.result.current.status).toBe('notInstalled')
  })

  test('a runner or translation change re-computes the label', async () => {
    const view = await setup(game(), '1 GB')
    mockTranslation.t = (key: string) => `[${key}]`
    view.render({ gameInfo: game(), gameSize: '1 GB' })
    await view.settle()
    expect(view.result.current.label).toBe('nile/[installed] 1 GB')
    mockTranslation.t = (key: string) => key

    view.render({ gameInfo: game({ runner: 'gog' }), gameSize: '1 GB' })
    await view.settle()
    expect(view.result.current.label).toBe('gog/installed 1 GB')
  })

  test('an unchanged status keeps the previous object', async () => {
    const view = await setup(game(), '1 GB')
    const before = view.result.current
    // a new GameInfo object with the same status inputs
    view.render({ gameInfo: game(), gameSize: '1 GB' })
    await view.settle()
    expect(view.result.current).toBe(before)
    // the check re-runs (new libraryStatus array) with the same outcome
    view.provide(ContextProvider, { ...context, libraryStatus: [] })
    view.render()
    await view.settle()
    expect(view.result.current).toBe(before)
  })
})
