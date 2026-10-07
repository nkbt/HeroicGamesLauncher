// nk: #4 - small hooks used by GameCard so that its upstream diff stays a few
// call-site lines (see logic.ts for the pure parts).
import { useCallback, useRef, useState } from 'react'
import { isStatusTransition, resolveFollowed, type Followed } from './logic'

/**
 * Drop-in for `useState(prop)` that follows the prop: a value set through the
 * setter (e.g. a re-fetched GameInfo) wins only until the parent passes a new
 * prop object (e.g. after a library refresh). No effect, no extra render.
 *
 * Every render returns a new setter, bound to that render's prop and stamped
 * with its render number. An effect that starts a fetch keeps the setter of
 * the render it ran after, so requests are ordered by when they started. A
 * response is dropped when a newer prop arrived meanwhile, or when a request
 * started later has already answered (overlapping status transitions).
 */
export function useFollowedState<T>(prop: T): [T, (value: T) => void] {
  const [fetched, setFetched] = useState<Followed<T> | null>(null)
  const latestProp = useRef(prop)
  latestProp.current = prop
  const renders = useRef(0)
  const answered = useRef(0) // render number of the latest recorded request
  const render = ++renders.current
  const set = (value: T) => {
    if (prop !== latestProp.current) return // superseded by a newer prop
    if (render < answered.current) return // a later request answered first
    answered.current = render
    setFetched({ from: prop, value })
  }
  return [resolveFollowed(fetched, prop), set]
}

/**
 * Returns a function to call inside a `[status]` effect: true only for a real
 * status transition, false for the effect's first run and for the initial
 * `undefined -> status` resolution.
 */
export function useStatusTransition<S>(status: S): () => boolean {
  const previous = useRef<S>(status)
  const latest = useRef<S>(status)
  latest.current = status
  return useCallback(() => {
    const prev = previous.current
    previous.current = latest.current
    return isStatusTransition(prev, latest.current)
  }, [])
}
