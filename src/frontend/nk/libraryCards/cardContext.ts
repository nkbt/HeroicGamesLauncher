// nk: #4 - which context changes a library card has to see.
//
// GlobalState passes a new context object on every setState (refresh flags,
// help items, zoom, theme, ...), and Library passes a new LibraryContext
// object on every render. Every card consumes both, so each of those updates
// used to re-render every eagerly rendered card. A card (and every component
// it renders) only reads the keys below, so it keeps the context values it
// already has until one of those keys changes. Pure, no React; used by
// IsolatedGameCard.
//
// Keep the key lists in sync with every `useContext(ContextProvider)` and
// `useContext(LibraryContext)` in the card's subtree;
// __tests__/cardContext.test.ts reads those files and fails when a card-side
// component starts reading a key that is not listed.

/** Context keys read by GameCard and the components/hooks it renders. */
export const CARD_CONTEXT_KEYS = [
  // GameCard
  'hiddenGames',
  'favouriteGames',
  'showDialogModal',
  'activeController',
  'connectivity',
  // hooks/hasStatus, UninstallModal
  'libraryStatus',
  'installingEpicGame',
  // Dialog, TextInputField, ToggleSwitch (uninstall / edit dialogs)
  'disableDialogBackdropClose',
  'isRTL'
] as const

/**
 * Store objects hasStatus only uses as "library changed, re-check status"
 * triggers. A library refresh replaces them whenever any game changed, but a
 * card only needs that when its own GameInfo changed (it then gets the live
 * value anyway, see selectCardContext).
 */
export const CARD_LIBRARY_KEYS = ['epic', 'gog'] as const

/** LibraryContext keys read by GameCard (nothing else in a card reads it). */
export const CARD_LIBRARY_CONTEXT_KEYS = ['layout'] as const

export interface CardContextMemo<V, G> {
  value: V
  gameInfo: G
}

/**
 * The context value to give a card: the value it already has (`prev.value`)
 * while its GameInfo object is unchanged and none of `keys` changed,
 * otherwise the live value. Keys outside the card's read set may be older in
 * a kept value; nothing in the card reads them.
 */
export function selectCardContext<V extends object, G>(
  prev: CardContextMemo<V, G> | null,
  live: V,
  gameInfo: G,
  keys: readonly string[] = CARD_CONTEXT_KEYS
): V {
  if (prev === null || prev.value === live) return live
  if (prev.gameInfo !== gameInfo) return live
  const a = prev.value as Record<string, unknown>
  const b = live as Record<string, unknown>
  for (const key of keys) {
    if (!Object.is(a[key], b[key])) return live
  }
  return prev.value
}
