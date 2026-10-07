// nk: #5 - game page Refresh button: re-fetches every cached detail of this
// game (see refresh.ts). The page keeps showing its data meanwhile; the
// icon spins and the tooltip counts the finished steps.
import './RefreshButton.css'

import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { Sync } from '@mui/icons-material'
import type { Runner, Status } from 'common/types'
import ContextProvider from 'frontend/state/ContextProvider'
import i18next from 'i18next'
import { useRefreshFailed, useRefreshProgress } from './hooks'
import {
  gameDetailsApi,
  gameDetailsStore,
  getLibraryGame,
  refreshStatus
} from './instance'
import { refreshGameDetails } from './refresh'

// a Refresh would race these (and fetch a changing install state)
const BUSY = new Set<Status>([
  'installing',
  'uninstalling',
  'extracting',
  'importing',
  'updating',
  'moving',
  'repairing',
  'playing',
  'launching'
])

export default function RefreshButton({
  runner,
  appName
}: {
  runner: Runner
  appName: string
}) {
  const { t } = useTranslation()
  const { platform, connectivity, libraryStatus, refreshing } =
    useContext(ContextProvider)
  const progress = useRefreshProgress(runner, appName)
  const failed = useRefreshFailed(runner, appName)
  const offline = connectivity.status !== 'online'
  const busy = libraryStatus.some(
    (game) => game.appName === appName && BUSY.has(game.status)
  )
  // `gogdl info` rewrites the GOG library file during a library refresh
  const waiting = runner === 'gog' && refreshing

  let title = t(
    'nk.game_details.refresh_tooltip',
    'Download all details of this game again: store info, sizes, ratings, achievements and artwork'
  )
  if (progress) {
    title = t(
      'nk.game_details.refreshing',
      'Refreshing game details ({{done}}/{{total}})',
      { done: progress.done, total: progress.total }
    )
  } else if (offline) {
    title = t(
      'nk.game_details.refresh_offline',
      'Refreshing game details needs a network connection'
    )
  } else if (failed > 0) {
    title = t(
      'nk.game_details.refresh_failed',
      'Some details could not be refreshed. The previous data is kept.'
    )
  }

  return (
    <button
      type="button"
      className={`svg-button settings-icon nk-details-refresh${
        progress ? ' is-refreshing' : ''
      }`}
      title={title}
      aria-label={
        progress ? title : t('nk.game_details.refresh', 'Refresh game details')
      }
      aria-busy={!!progress}
      disabled={!!progress || offline || busy || waiting}
      onClick={() => {
        const gameInfo = getLibraryGame(runner, appName)
        if (!gameInfo) return
        void refreshGameDetails(gameInfo, {
          gameDetailsApi,
          store: gameDetailsStore,
          invalidateGameDetailsCaches: window.api.invalidateGameDetailsCaches,
          refreshStatus,
          platform,
          language: i18next.language ?? '',
          online: !offline
        })
      }}
    >
      <Sync />
    </button>
  )
}
