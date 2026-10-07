import { createHookRoot } from 'frontend/nk/test/hookRuntime'
import { useFollowedState } from 'frontend/nk/libraryCards/hooks'

jest.mock(
  'react',
  () =>
    jest.requireActual<typeof import('frontend/nk/test/hookRuntime')>(
      'frontend/nk/test/hookRuntime'
    ).react
)

interface Info {
  app_name: string
  title: string
}

function setup(gameInfo: Info) {
  const view = createHookRoot((prop: Info) => useFollowedState(prop))
  view.render(gameInfo)
  return view
}

describe('useFollowedState', () => {
  test('a fetched value wins until the prop changes', () => {
    const listA = { app_name: 'game-a', title: 'list A' }
    const view = setup(listA)
    const fetched = { app_name: 'game-a', title: 'fetched' }
    view.result.current[1](fetched)
    view.render()
    expect(view.result.current[0]).toBe(fetched)

    const listB = { app_name: 'game-a', title: 'list B' }
    view.render(listB)
    expect(view.result.current[0]).toBe(listB)
  })

  test('a list refresh that lands before an older request wins', () => {
    const listA = { app_name: 'game-a', title: 'list A' }
    const view = setup(listA)
    // a status effect starts a fetch with the setter of this render
    const setFromRequestA = view.result.current[1]

    // the library refresh delivers newer list data while it is pending
    const listB = { app_name: 'game-a', title: 'list B' }
    view.render(listB)

    // the older response arrives last and is dropped
    setFromRequestA({ app_name: 'game-a', title: 'stale response' })
    view.render()
    expect(view.result.current[0]).toBe(listB)
  })

  test('an older response does not replace a newer fetched value', () => {
    const listA = { app_name: 'game-a', title: 'list A' }
    const view = setup(listA)
    const setFromRequestA = view.result.current[1]

    const listB = { app_name: 'game-a', title: 'list B' }
    view.render(listB)
    const fetchedB = { app_name: 'game-a', title: 'fetched for B' }
    view.result.current[1](fetchedB)
    view.render()
    expect(view.result.current[0]).toBe(fetchedB)

    setFromRequestA({ app_name: 'game-a', title: 'stale response' })
    view.render()
    expect(view.result.current[0]).toBe(fetchedB)
  })

  test('overlapping requests for the same prop: a later request answered first wins', () => {
    const listA = { app_name: 'game-a', title: 'list A' }
    const view = setup(listA)
    // status transition 1 (e.g. installing) starts a request
    const setFromRequest1 = view.result.current[1]
    // status transition 2 (e.g. installed) re-renders with the same prop and
    // starts another request
    view.render(listA)
    const setFromRequest2 = view.result.current[1]

    const newer = { app_name: 'game-a', title: 'response 2' }
    setFromRequest2(newer)
    view.render()
    setFromRequest1({ app_name: 'game-a', title: 'response 1' })
    view.render()
    expect(view.result.current[0]).toBe(newer)
  })

  test('overlapping requests for the same prop answering in order', () => {
    const listA = { app_name: 'game-a', title: 'list A' }
    const view = setup(listA)
    const setFromRequest1 = view.result.current[1]
    view.render(listA)
    const setFromRequest2 = view.result.current[1]

    setFromRequest1({ app_name: 'game-a', title: 'response 1' })
    view.render()
    const newer = { app_name: 'game-a', title: 'response 2' }
    setFromRequest2(newer)
    view.render()
    expect(view.result.current[0]).toBe(newer)
  })
})
