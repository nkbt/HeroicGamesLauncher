// nk: #6 - keep the Library screen mounted for the whole session.
//
// Rendered by `Root` (App.tsx) right after <Outlet />; the index route renders
// nothing. The Library is mounted on the first visit to `/` and never
// unmounted afterwards: on other routes it is only hidden with
// `display: none`, so search text, letter filter, card state, fetched info and
// decoded images all survive a trip to a game page (or any other screen).
// `display: contents` keeps the layout identical to the upstream route render.
//
// `document.body` is the scroll container shared by every screen, so the
// Library's offset is saved/restored here (see libraryViewKeeper.ts).
import './KeepAliveLibrary.css'

import {
  type Context,
  createContext,
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  useLocation,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext
} from 'react-router-dom'
import Library from 'frontend/screens/Library'
import ContextProvider from 'frontend/state/ContextProvider'
import { LIBRARY_TOUR_ID } from 'frontend/screens/Library/components/LibraryTour'
import { useTour } from 'frontend/state/TourContext'
import { createLibraryViewKeeper } from './libraryViewKeeper'
import {
  freezeRootRoute,
  getRouterContexts,
  isLocationContextValue,
  isRouteContextValue,
  type LocationContextValue,
  type RouteContextValue,
  shouldFollowLocation
} from './routerIsolation'
import {
  isNavigationContextValue,
  withMemoizedCreateHref
} from './navigationIsolation'
import { structuralShare } from './structuralShare'

const SCROLL_POSITION_KEY = 'scrollPosition' // upstream Library's key

const routerContexts = getRouterContexts(
  UNSAFE_LocationContext,
  UNSAFE_RouteContext
)
// Stand-in so the hooks below are called unconditionally when react-router no
// longer exports the contexts (its value then fails the shape guard).
const MissingContext = createContext<unknown>(null)
let warnedUnsupported = false

/**
 * Router context isolation. Every navigation gives `Root`'s children a new
 * RouteContext value (new `outlet`/`matches`) and a new LocationContext value.
 * Each GameCard consumes both (`useNavigate`, `<Link>` -> `useHref`), so
 * without this every navigation anywhere would re-render every card of the
 * kept (even hidden) Library. The Library only ever lives at `/` under the
 * root route and uses absolute paths, so it gets:
 * - a RouteContext fixed to the root route (no outlet), captured while the
 *   Library is active, and
 * - a LocationContext that only follows the live value while the Library is
 *   active and the path (pathname + search + hash) actually changed.
 * Returns null (render <Library /> unwrapped, upstream behaviour) if
 * react-router's internals no longer look as expected (see routerIsolation.ts).
 */
function useIsolatedRouterContexts(active: boolean): {
  route: RouteContextValue
  location: LocationContextValue
} | null {
  const liveLocation = useContext<unknown>(
    (routerContexts?.LocationContext as Context<unknown>) ?? MissingContext
  )
  const liveRoute = useContext<unknown>(
    (routerContexts?.RouteContext as Context<unknown>) ?? MissingContext
  )
  const route = useRef<RouteContextValue | null>(null)
  const location = useRef<LocationContextValue | null>(null)

  if (
    !isLocationContextValue(liveLocation) ||
    !isRouteContextValue(liveRoute)
  ) {
    if (!warnedUnsupported) {
      warnedUnsupported = true
      console.warn(
        '[nk] KeepAliveLibrary: react-router contexts changed shape; router isolation disabled'
      )
    }
    return null
  }

  if (active && route.current === null) {
    route.current = freezeRootRoute(liveRoute)
  }
  if (
    location.current === null ||
    shouldFollowLocation(
      active,
      location.current.location,
      liveLocation.location
    )
  ) {
    location.current = liveLocation
  }
  if (route.current === null) return null // not yet active: nothing rendered
  return { route: route.current, location: location.current }
}

/**
 * #4: the GlobalState context value given to the kept Library.
 * GlobalState passes a new context object on every setState, which
 * re-renders every (eagerly rendered) card: several hundred ms in the dev
 * build. While the Library is hidden it keeps the last value it saw (no
 * re-render at all). While it is shown it follows the live value in a
 * transition: React renders the cards in interruptible slices instead of one
 * long task, and the return to the Library paints with the held value before
 * catching up. The live value is structurally shared with the shown one
 * first: unchanged games keep their GameInfo objects after a library refresh,
 * and a value that is deep-equal to the shown one causes no render at all.
 */
function useGatedGlobalState(active: boolean) {
  const live = useContext(ContextProvider)
  const [shown, setShown] = useState(live)
  const lastLive = useRef(live)
  useEffect(() => {
    if (!active || lastLive.current === live) return
    lastLive.current = live
    const next = structuralShare(shown, live)
    if (next !== shown) startTransition(() => setShown(next))
  }, [active, live, shown])
  return shown
}

/** #4: NavigationContext with a cached `createHref` (navigationIsolation.ts) */
function useMemoizedNavigation() {
  const live = useContext<unknown>(
    (UNSAFE_NavigationContext as Context<unknown> | undefined) ?? MissingContext
  )
  return useMemo(() => {
    if (!UNSAFE_NavigationContext || !isNavigationContextValue(live)) {
      return null
    }
    const base = document.querySelector('base')?.getAttribute('href')
    return withMemoizedCreateHref(live, !!base)
  }, [live])
}

function storeScrollPosition(value: number) {
  try {
    window.localStorage.setItem(SCROLL_POSITION_KEY, String(value))
  } catch {
    // storage unavailable: nothing to persist
  }
}

export default function KeepAliveLibrary() {
  const { pathname, key } = useLocation()
  const active = pathname === '/'

  const [mounted, setMounted] = useState(active)
  if (active && !mounted) setMounted(true)

  const [keeper] = useState(createLibraryViewKeeper)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)
  const isolated = useIsolatedRouterContexts(active)
  const globalState = useGatedGlobalState(active)
  const navigation = useMemoizedNavigation()
  // the same element every render: Library re-renders only through the
  // contexts it consumes (all of them gated here)
  const library = useMemo(() => <Library />, [])

  // Body scroll listener. Registered in the same commit as Library's own
  // `storeScrollPosition` listener but after it (child layout effects run
  // first), so on the shared target it always fires after Library's write:
  // while hidden it re-pins localStorage `scrollPosition` to the Library
  // offset, so an app restart reopens the Library where it was left.
  useLayoutEffect(() => {
    if (!mounted) return
    const onScroll = () => {
      if (keeper.isActive()) {
        keeper.onScroll(document.body.scrollTop)
        return
      }
      const saved = keeper.savedScroll()
      if (saved !== null) storeScrollPosition(saved)
    }
    document.body.addEventListener('scroll', onScroll, { passive: true })
    return () => document.body.removeEventListener('scroll', onScroll)
  }, [mounted, keeper])

  useLayoutEffect(() => {
    if (!mounted) return
    if (!active) {
      if (keeper.isActive()) {
        keeper.deactivate()
        containerRef.current?.setAttribute('data-restored', '')
      }
      return
    }

    const reactivation = !keeper.isActive() && keeper.savedScroll() !== null
    const y = keeper.activate(key, document.body.scrollTop)
    if (y !== null) {
      document.body.scrollTo(0, y)
      storeScrollPosition(y)
    }
    if (!reactivation) return

    // Library measures its sticky header height on `resize`; it read 0 if
    // the window changed while hidden (or fonts/zoom changed elsewhere).
    window.dispatchEvent(new Event('resize'))

    // gamepad: put the cursor back on the card that was opened
    const el = lastFocused.current
    if (
      el &&
      el.isConnected &&
      document.body.classList.contains('controllerLayout')
    ) {
      el.focus({ preventScroll: true })
    }
  }, [active, key, mounted, keeper])

  // An unmount used to end the intro tour implicitly; hiding does not.
  const { isTourActive, endTour } = useTour()
  useEffect(() => {
    if (!active && isTourActive(LIBRARY_TOUR_ID)) endTour(LIBRARY_TOUR_ID)
  }, [active, isTourActive, endTour])

  if (!mounted) return null

  const gatedLibrary = (
    <ContextProvider.Provider value={globalState}>
      {navigation ? (
        <UNSAFE_NavigationContext.Provider value={navigation}>
          {library}
        </UNSAFE_NavigationContext.Provider>
      ) : (
        library
      )}
    </ContextProvider.Provider>
  )
  return (
    <div
      ref={containerRef}
      data-keepalive="library"
      style={{ display: active ? 'contents' : 'none' }}
      onFocus={(e) => {
        lastFocused.current = e.target
      }}
    >
      {routerContexts && isolated ? (
        <routerContexts.RouteContext.Provider value={isolated.route}>
          <routerContexts.LocationContext.Provider value={isolated.location}>
            {gatedLibrary}
          </routerContexts.LocationContext.Provider>
        </routerContexts.RouteContext.Provider>
      ) : (
        gatedLibrary
      )}
    </div>
  )
}
