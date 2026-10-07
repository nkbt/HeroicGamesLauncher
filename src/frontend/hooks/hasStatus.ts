import React from 'react'
import ContextProvider from 'frontend/state/ContextProvider'
import { GameInfo, GameStatus } from 'common/types'
import { hasProgress } from './hasProgress'
import { useTranslation } from 'react-i18next'
import { getStatusLabel, handleNonAvailableGames } from './constants'
import { skipUnchangedStatus } from 'frontend/nk/libraryCards' // nk: #4
import * as nk from 'frontend/nk/gameDetails/statusHooks' // nk: #5

export function hasStatus(gameInfo: GameInfo, gameSize?: string) {
  const appName = gameInfo.app_name
  const { libraryStatus, epic, gog } = React.useContext(ContextProvider)
  const [progress] = hasProgress(gameInfo.app_name, gameInfo.runner)
  const [newGameInfo, setNewGameInfo] = React.useState<GameInfo | undefined>(
    gameInfo
  )
  const { t } = useTranslation('gamepage')

  const [gameStatus, nkSetGameStatus /* nk: #4 */] = nk.useGameStatusState(
    gameInfo,
    t
  ) // nk: #5
  const setGameStatus = nk.rememberingStatus(
    appName,
    skipUnchangedStatus(nkSetGameStatus)
  ) // nk: #4 single place for status updates; #5 remembered

  const {
    thirdPartyManagedApp = undefined,
    is_installed,
    runner = 'sideload',
    isEAManaged,
    isUbisoftManaged
  } = { ...(gameInfo ?? newGameInfo) } // nk: #4 live gameInfo; newGameInfo is the fetch fallback

  React.useEffect(() => {
    if (newGameInfo) {
      return
    }
    const getGameInfo = async () => {
      const updatedInfo = await window.api.getGameInfo(
        appName,
        runner || 'sideload'
      )
      if (updatedInfo) {
        setNewGameInfo(updatedInfo)
      }
    }
    getGameInfo()
  }, [appName, gameInfo])

  React.useEffect(() => {
    const checkGameStatus = async () => {
      const {
        status,
        folder,
        context: statusContext
      } = libraryStatus.find((game: GameStatus) => game.appName === appName) ||
      {}

      if (status && status !== 'done') {
        const label = getStatusLabel({
          status,
          t,
          runner,
          size: gameSize,
          statusContext,
          percent: progress.percent
        })
        return setGameStatus({ status, folder, label, statusContext })
      }

      if (thirdPartyManagedApp && !isEAManaged && !isUbisoftManaged) {
        const label = getStatusLabel({
          status: 'notSupportedGame',
          t,
          runner
        })
        return setGameStatus({
          status: 'notSupportedGame',
          label,
          statusContext
        })
      }

      if (is_installed && !thirdPartyManagedApp) {
        const gameAvailable = await handleNonAvailableGames(appName, runner)
        if (!gameAvailable) {
          const label = getStatusLabel({
            status: 'notAvailable',
            t,
            runner
          })
          return setGameStatus({ status: 'notAvailable', label, statusContext })
        }
        const label = getStatusLabel({
          status: 'installed',
          t,
          runner,
          size: gameSize
        })
        return setGameStatus({ status: 'installed', label, statusContext })
      }

      const label = getStatusLabel({
        status: 'notInstalled',
        t,
        runner
      })
      return setGameStatus({ status: 'notInstalled', label, statusContext })
    }
    checkGameStatus()
  }, [
    libraryStatus,
    appName,
    epic.library,
    gog.library,
    is_installed,
    gameSize, // nk: #4
    thirdPartyManagedApp, // nk: #4
    isEAManaged, // nk: #4
    isUbisoftManaged, // nk: #4
    runner, // nk: #4
    t, // nk: #4
    progress.percent
  ])

  return gameStatus
}
