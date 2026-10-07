// nk: #4 - memoized `createHref` for the kept-alive Library's <Link>s.
//
// react-router's hash history builds every href with
// `document.querySelector('base')` (@remix-run/router createHashHref). With
// ~1000 eagerly rendered cards that is ~1000 full-document scans (15k+ nodes,
// no <base>) on every Library re-render: >100 ms measured, in any build.
// Without a <base href> the result only depends on the target path, so it is
// cached per path. Uses react-router's exported-but-unstable
// `UNSAFE_NavigationContext`; any shape mismatch disables the memo (upstream
// behaviour).
import type { ContextType } from 'react'
import {
  createPath,
  type To,
  type UNSAFE_NavigationContext
} from 'react-router-dom'

export type NavigationContextValue = ContextType<
  typeof UNSAFE_NavigationContext
>

const MAX_CACHED_HREFS = 5000

export function isNavigationContextValue(
  value: unknown
): value is NavigationContextValue {
  if (typeof value !== 'object' || value === null) return false
  const navigator = (value as { navigator?: unknown }).navigator
  return (
    typeof navigator === 'object' &&
    navigator !== null &&
    typeof (navigator as { createHref?: unknown }).createHref === 'function'
  )
}

/**
 * Same context value with a navigator whose `createHref` is cached per target
 * path. The navigator keeps every other member through its prototype. Returns
 * the value unchanged when the document has a `<base href>` (hrefs then
 * depend on the current URL).
 */
export function withMemoizedCreateHref(
  value: NavigationContextValue,
  hasBaseHref: boolean
): NavigationContextValue {
  if (hasBaseHref) return value
  const original = value.navigator
  const cache = new Map<string, string>()
  const navigator = Object.create(original) as typeof original
  navigator.createHref = (to: To) => {
    const key = typeof to === 'string' ? to : createPath(to)
    let href = cache.get(key)
    if (href === undefined) {
      href = original.createHref(to)
      if (cache.size >= MAX_CACHED_HREFS) cache.clear()
      cache.set(key, href)
    }
    return href
  }
  return { ...value, navigator }
}
