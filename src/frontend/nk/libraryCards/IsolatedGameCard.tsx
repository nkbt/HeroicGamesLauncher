// nk: #4 - GameCard as rendered by GamesList, isolated from unrelated
// GlobalState updates.
//
// With every card rendered eagerly, each GlobalState setState (library
// refresh start/end, help items on a game page visit, ...) re-rendered every
// card. This wrapper renders the upstream GameCard:
// - memoized, with a stable `buttonClick` (GamesList passes a new arrow on
//   every render; the latest one is called through a ref), and
// - under its own GlobalState and LibraryContext values, which only change
//   when a key the card reads changes or its GameInfo object changes (see
//   cardContext.ts).
// The wrapper itself still re-renders per update, but it is a few hook calls.
import {
  type ComponentProps,
  memo,
  useCallback,
  useContext,
  useRef
} from 'react'
import GameCard from 'frontend/screens/Library/components/GameCard'
import LibraryContext from 'frontend/screens/Library/LibraryContext'
import ContextProvider from 'frontend/state/ContextProvider'
import {
  CARD_LIBRARY_CONTEXT_KEYS,
  type CardContextMemo,
  selectCardContext
} from './cardContext'

type Props = ComponentProps<typeof GameCard>
type GameInfo = Props['gameInfo']

/** The live context value, or the card's previous one (see cardContext.ts). */
function useCardContext<V extends object>(
  live: V,
  gameInfo: GameInfo,
  keys?: readonly string[]
): V {
  const last = useRef<CardContextMemo<V, GameInfo> | null>(null)
  // Derived during render: a kept value only ever differs from the live one
  // in keys the card does not read, so an uncommitted render is harmless.
  const value = selectCardContext(last.current, live, gameInfo, keys)
  last.current = { value, gameInfo }
  return value
}

const MemoGameCard = memo(GameCard)

function IsolatedGameCard(props: Props) {
  const globalState = useCardContext(
    useContext(ContextProvider),
    props.gameInfo
  )
  const library = useCardContext(
    useContext(LibraryContext),
    props.gameInfo,
    CARD_LIBRARY_CONTEXT_KEYS
  )

  const latestClick = useRef(props.buttonClick)
  latestClick.current = props.buttonClick
  const buttonClick = useCallback(() => latestClick.current(), [])

  return (
    <ContextProvider.Provider value={globalState}>
      <LibraryContext.Provider value={library}>
        <MemoGameCard {...props} buttonClick={buttonClick} />
      </LibraryContext.Provider>
    </ContextProvider.Provider>
  )
}

export default IsolatedGameCard
