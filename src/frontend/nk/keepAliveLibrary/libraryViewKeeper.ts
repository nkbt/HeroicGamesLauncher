// nk: #6 - pure (DOM-free) scroll state machine for the kept-alive Library.
//
// The Library screen stays mounted for the whole session (see
// KeepAliveLibrary.tsx) and is only hidden while another route is active.
// `document.body` is the scroll container shared by every screen, so the
// Library's scroll offset has to be saved while it is visible and re-applied
// when it is shown again. This module decides *what* to apply; the component
// does the DOM work.

export interface LibraryViewKeeper {
  /** true while the Library route is the active one */
  isActive(): boolean
  /** records the body scroll offset, but only while the Library is active */
  onScroll(scrollTop: number): void
  /** the Library got hidden (another route became active) */
  deactivate(): void
  /**
   * The Library route is active for `locationKey`. Returns the scrollTop to
   * apply, or null to leave the scroll position untouched.
   * - first activation ever: seeds the saved offset from `currentScrollTop`
   *   (Library's own mount-time restore has just run) and returns null
   * - re-activation after being hidden: returns the saved offset (a number)
   * - already active, new location key (sidebar "Library" re-click): 0
   * - already active, same key: null
   */
  activate(locationKey: string, currentScrollTop: number): number | null
  /** last Library offset; null only before the first activation */
  savedScroll(): number | null
}

export function createLibraryViewKeeper(): LibraryViewKeeper {
  let active = false
  let saved: number | null = null
  let lastKey: string | null = null

  return {
    isActive: () => active,

    onScroll(scrollTop) {
      if (!active) return
      saved = scrollTop
    },

    deactivate() {
      active = false
    },

    activate(locationKey, currentScrollTop) {
      if (active) {
        if (locationKey === lastKey) return null
        lastKey = locationKey
        saved = 0
        return 0
      }
      active = true
      lastKey = locationKey
      if (saved === null) {
        saved = currentScrollTop
        return null
      }
      return saved
    },

    savedScroll: () => saved
  }
}
