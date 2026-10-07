// nk: #4 - pure helpers behind the eager library cards (unit-tested; no React,
// no DOM).

/** A value fetched for a specific prop object; superseded by a new prop. */
export interface Followed<T> {
  from: T
  value: T
}

/**
 * The fetched value while the prop object is still the one it was fetched
 * for, otherwise the (newer) prop itself. Derived during render, so a library
 * refresh costs no extra render per card.
 */
export function resolveFollowed<T>(fetched: Followed<T> | null, prop: T): T {
  return fetched !== null && fetched.from === prop ? fetched.value : prop
}

/**
 * Whether a card status change is a real transition (install finished,
 * uninstall, update, move, ...) worth re-reading GameInfo for. The first
 * resolution after mount (`undefined -> x`) is not.
 */
export function isStatusTransition<S>(prev: S | undefined, next: S): boolean {
  return prev !== undefined && prev !== next
}

export interface GameStatusLike {
  status?: string
  statusContext?: string
  folder?: string
  label: string
}

export function sameGameStatus(a: GameStatusLike, b: GameStatusLike) {
  return (
    a.status === b.status &&
    a.label === b.label &&
    a.folder === b.folder &&
    a.statusContext === b.statusContext
  )
}

/**
 * Wraps a React state setter so that setting an equal status keeps the
 * previous object (React then bails out: no card re-render).
 */
export function skipUnchangedStatus<T extends GameStatusLike>(
  setState: (update: (prev: T) => T) => void
) {
  return (next: T) =>
    setState((prev) => (sameGameStatus(prev, next) ? prev : next))
}

/**
 * Mount state of a lazily mounted menu: mounted while open and until its
 * close transition has finished.
 */
export function lazyMenuMounted(
  open: boolean,
  state: { wasOpen: boolean; exiting: boolean }
): { wasOpen: boolean; exiting: boolean; mounted: boolean } {
  const exiting = open ? false : state.exiting || state.wasOpen
  return { wasOpen: open, exiting, mounted: open || exiting }
}
