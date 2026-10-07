// nk: #6 - pure helpers for KeepAliveLibrary's router-context isolation.
//
// The isolation relies on react-router's exported-but-unstable
// `UNSAFE_LocationContext` / `UNSAFE_RouteContext` (react-router 6.x). Every
// assumption about them is checked here (and unit-tested), so a react-router
// change makes KeepAliveLibrary render <Library /> unwrapped (upstream
// behaviour, just slower) instead of breaking navigation.
import type { Context, ContextType } from 'react'
import {
  createPath,
  type Location,
  type UNSAFE_LocationContext,
  type UNSAFE_RouteContext
} from 'react-router-dom'

export type LocationContextValue = ContextType<typeof UNSAFE_LocationContext>
export type RouteContextValue = ContextType<typeof UNSAFE_RouteContext>

export interface RouterContexts {
  LocationContext: typeof UNSAFE_LocationContext
  RouteContext: typeof UNSAFE_RouteContext
}

export function isReactContext(value: unknown): value is Context<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'Provider' in value &&
    'Consumer' in value
  )
}

/**
 * The two contexts (pass react-router's `UNSAFE_LocationContext` and
 * `UNSAFE_RouteContext`), or null when they are not React contexts.
 */
export function getRouterContexts(
  locationContext: unknown,
  routeContext: unknown
): RouterContexts | null {
  if (!isReactContext(locationContext) || !isReactContext(routeContext)) {
    return null
  }
  return {
    LocationContext: locationContext as typeof UNSAFE_LocationContext,
    RouteContext: routeContext as typeof UNSAFE_RouteContext
  }
}

export function isLocationContextValue(
  value: unknown
): value is LocationContextValue {
  if (typeof value !== 'object' || value === null) return false
  const location = (value as { location?: unknown }).location
  return (
    typeof location === 'object' &&
    location !== null &&
    typeof (location as { pathname?: unknown }).pathname === 'string'
  )
}

export function isRouteContextValue(
  value: unknown
): value is RouteContextValue {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { matches?: unknown }
  return Array.isArray(v.matches) && v.matches.length > 0 && 'outlet' in value
}

/**
 * Whether the Library's held LocationContext value should be replaced by the
 * live one: only while the Library is shown and its path (pathname + search +
 * hash) actually changed. A new key/state alone (same path) or any navigation
 * while hidden keeps the held value, so the kept cards do not re-render.
 */
export function shouldFollowLocation(
  active: boolean,
  held: Pick<Location, 'pathname' | 'search' | 'hash'>,
  live: Pick<Location, 'pathname' | 'search' | 'hash'>
): boolean {
  return active && createPath(held) !== createPath(live)
}

/**
 * RouteContext for the kept Library: the root route with no outlet. Must be
 * built from the value seen while the Library is active (at `/`). react-router
 * shares one `params` object across matches, so params are reset to `{}` (the
 * Library route has none) to never leak another page's `:appName`.
 */
export function freezeRootRoute(live: RouteContextValue): RouteContextValue {
  return {
    ...live,
    outlet: null,
    matches: live.matches.map((match) => ({ ...match, params: {} }))
  }
}
