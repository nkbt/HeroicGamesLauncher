import React, { useContext, useEffect, useRef } from 'react'
import { GameInfo, Runner } from 'common/types'
import cx from 'classnames'
import GameCard from 'frontend/nk/libraryCards/IsolatedGameCard' // nk: #4 memoized, context-isolated card
import ContextProvider from 'frontend/state/ContextProvider'
import { useTranslation } from 'react-i18next'

interface Props {
  library: GameInfo[]
  layout?: string
  isFirstLane?: boolean
  handleGameCardClick: (
    app_name: string,
    runner: Runner,
    gameInfo: GameInfo
  ) => void
  onlyInstalled?: boolean
  isRecent?: boolean
  isFavourite?: boolean
}

// When a card is focused in the library,
const scrollCardIntoView = (ev: FocusEvent) => {
  const windowHeight = window.innerHeight
  const trgt = ev.target as HTMLElement
  const rect = trgt.getBoundingClientRect()

  if (rect.top < 100) {
    // if it's too close to the top, scroll a bit down
    document.body.scrollTo({
      top: trgt.parentElement!.offsetTop - 200,
      behavior: 'smooth'
    })
  } else if (rect.bottom > windowHeight - 100) {
    // if it's too close to the bottom, scroll a bit up
    document.body.scrollTo({
      top: trgt.parentElement!.offsetTop - windowHeight + rect.height + 150,
      behavior: 'smooth'
    })
  }
}

const GamesList = ({
  library = [],
  layout = 'grid',
  handleGameCardClick,
  isFirstLane = false,
  onlyInstalled = false,
  isRecent = false,
  isFavourite = false
}: Props): JSX.Element => {
  const { gameUpdates, allTilesInColor, titlesAlwaysVisible } =
    useContext(ContextProvider)
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement | null>(null)
  const { activeController } = useContext(ContextProvider)

  useEffect(() => {
    if (listRef.current && activeController) {
      listRef.current.addEventListener('focus', scrollCardIntoView, {
        capture: true
      })

      return () => {
        listRef.current?.removeEventListener('focus', scrollCardIntoView, {
          capture: true
        })
      }
    }

    return () => ({})
  }, [listRef.current, activeController])

  return (
    <div
      style={!library.length ? { backgroundColor: 'transparent' } : {}}
      className={cx({
        gameList: layout === 'grid',
        gameListLayout: layout === 'list',
        firstLane: isFirstLane,
        allTilesInColor,
        titlesAlwaysVisible
      })}
      ref={listRef}
    >
      {layout === 'list' && (
        <div className="gameListHeader">
          <span>{t('game.title', 'Game Title')}</span>
          <span>{t('game.status', 'Status')}</span>
          <span>{t('game.store', 'Store')}</span>
          <span>{t('wine.actions', 'Action')}</span>
        </div>
      )}
      {!!library.length &&
        library.map((gameInfo, index) => {
          const { app_name, is_installed, runner } = gameInfo
          const isJustPlayed = (isFavourite || isRecent) && index === 0
          let is_dlc = false
          if (gameInfo.runner !== 'sideload') {
            is_dlc = gameInfo.install.is_dlc ?? false
          }

          if (is_dlc) {
            return null
          }
          if (!is_installed && onlyInstalled) {
            return null
          }

          const hasUpdate = is_installed && gameUpdates?.includes(app_name)
          return (
            <GameCard
              key={`${runner}_${app_name}${isFirstLane ? '_firstlane' : ''}`}
              hasUpdate={hasUpdate}
              buttonClick={() => {
                if (gameInfo.runner !== 'sideload')
                  handleGameCardClick(app_name, runner, gameInfo)
              }}
              forceCard={layout === 'grid'}
              isRecent={isRecent}
              gameInfo={gameInfo}
              justPlayed={isJustPlayed}
              dataTour={index === 0 ? 'library-game-card' : undefined}
            />
          )
        })}
    </div>
  )
}

export default React.memo(GamesList)
