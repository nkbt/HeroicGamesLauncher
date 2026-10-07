import { createContext, createElement, useContext } from 'react'
import { renderToString } from 'react-dom/server'
import {
  createPath,
  MemoryRouter,
  Route,
  Routes,
  UNSAFE_LocationContext,
  UNSAFE_RouteContext
} from 'react-router-dom'
import {
  freezeRootRoute,
  getRouterContexts,
  isLocationContextValue,
  isRouteContextValue,
  type RouteContextValue,
  shouldFollowLocation
} from '../routerIsolation'

const loc = (pathname: string, search = '', hash = '') => ({
  pathname,
  search,
  hash
})

describe('nk/keepAliveLibrary routerIsolation', () => {
  // Guards the react-router internals KeepAliveLibrary depends on. If one of
  // these fails after a react-router upgrade, re-check KeepAliveLibrary.
  describe('react-router contract', () => {
    test('UNSAFE_LocationContext / UNSAFE_RouteContext are React contexts', () => {
      const contexts = getRouterContexts(
        UNSAFE_LocationContext,
        UNSAFE_RouteContext
      )
      expect(contexts).not.toBeNull()
      expect(contexts?.LocationContext).toBe(UNSAFE_LocationContext)
      expect(contexts?.RouteContext).toBe(UNSAFE_RouteContext)
    })

    test('live values inside a router pass the shape guards', () => {
      let liveLocation: unknown
      let liveRoute: unknown
      // MemoryRouter's useLayoutEffect warns under server rendering
      const error = jest.spyOn(console, 'error').mockImplementation(() => {})
      function Probe() {
        liveLocation = useContext(UNSAFE_LocationContext)
        liveRoute = useContext(UNSAFE_RouteContext)
        return null
      }
      renderToString(
        createElement(
          MemoryRouter,
          { initialEntries: ['/gamepage/test-runner/game-a'] },
          createElement(
            Routes,
            null,
            createElement(
              Route,
              { path: '/', element: createElement(Probe) },
              createElement(Route, {
                path: 'gamepage/:runner/:appName',
                element: null
              })
            )
          )
        )
      )
      error.mockRestore()
      expect(isLocationContextValue(liveLocation)).toBe(true)
      expect(isRouteContextValue(liveRoute)).toBe(true)
      const route = liveRoute as RouteContextValue
      expect(route.outlet).not.toBeNull()
      // react-router shares the leaf params with the root match: the reason
      // freezeRootRoute resets them
      expect(route.matches[0].params).toEqual({
        runner: 'test-runner',
        appName: 'game-a'
      })
    })

    test('createPath joins pathname, search and hash', () => {
      expect(createPath(loc('/', '?a=1', '#x'))).toBe('/?a=1#x')
      expect(createPath(loc('/'))).toBe('/')
    })
  })

  test('getRouterContexts returns null when an export is missing or not a context', () => {
    expect(getRouterContexts(undefined, UNSAFE_RouteContext)).toBeNull()
    expect(getRouterContexts(UNSAFE_LocationContext, {})).toBeNull()
    const a = createContext(null)
    const b = createContext(null)
    expect(getRouterContexts(a, b)).toEqual({
      LocationContext: a,
      RouteContext: b
    })
  })

  test('shape guards', () => {
    expect(isLocationContextValue(null)).toBe(false)
    expect(isLocationContextValue({})).toBe(false)
    expect(
      isLocationContextValue({ location: loc('/'), navigationType: 'POP' })
    ).toBe(true)
    expect(isRouteContextValue(null)).toBe(false)
    expect(isRouteContextValue({ outlet: null, matches: [] })).toBe(false)
    expect(isRouteContextValue({ matches: [{}] })).toBe(false)
    expect(
      isRouteContextValue({ outlet: null, matches: [{}], isDataRoute: true })
    ).toBe(true)
  })

  describe('shouldFollowLocation', () => {
    test('follows a path change while active', () => {
      expect(shouldFollowLocation(true, loc('/gamepage/a/b'), loc('/'))).toBe(
        true
      )
      expect(shouldFollowLocation(true, loc('/'), loc('/', '?q=1'))).toBe(true)
      expect(shouldFollowLocation(true, loc('/'), loc('/', '', '#h'))).toBe(
        true
      )
    })

    test('ignores the same path while active (new key or state only)', () => {
      expect(shouldFollowLocation(true, loc('/'), loc('/'))).toBe(false)
    })

    test('never follows while hidden', () => {
      expect(shouldFollowLocation(false, loc('/'), loc('/gamepage/a/b'))).toBe(
        false
      )
    })
  })

  test('freezeRootRoute drops the outlet and resets shared params', () => {
    const params = { runner: 'test-runner', appName: 'game-a' }
    const live = {
      outlet: 'outlet-element',
      matches: [{ params, pathname: '/', route: { id: '0' } }],
      isDataRoute: true
    } as unknown as RouteContextValue
    const frozen = freezeRootRoute(live)
    expect(frozen.outlet).toBeNull()
    expect(frozen.isDataRoute).toBe(true)
    expect(frozen.matches).toHaveLength(1)
    expect(frozen.matches[0].params).toEqual({})
    expect(frozen.matches[0].pathname).toBe('/')
    // the live value is not mutated
    expect(live.matches[0].params).toBe(params)
    expect(live.outlet).toBe('outlet-element')
  })
})
