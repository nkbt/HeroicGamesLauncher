import { useDetailsArt } from 'frontend/nk/gameDetails/hooks' // nk: #5
import './index.css'

import React, { useContext, useEffect, useState } from 'react' // nk: #5

import {
  ArrowBackIosNew,
  Info,
  Star,
  Monitor,
  EmojiEvents
} from '@mui/icons-material'

import { Tab, Tabs } from '@mui/material'

import { getGameInfo, sendKill } from 'frontend/helpers' // nk: #5
import { launch, updateGame, install } from 'frontend/helpers/library'
import { Link, NavLink, useLocation, useParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import ContextProvider from 'frontend/state/ContextProvider'
import { CachedImage, UpdateComponent, TabPanel } from 'frontend/components/UI'
import UninstallModal from 'frontend/components/UI/UninstallModal'

import { GameInfo, Runner } from 'common/types' // nk: #5

import GamePicture from '../GamePicture'
import TimeContainer from '../TimeContainer'

import { hasProgress } from 'frontend/hooks/hasProgress'
import ErrorComponent from 'frontend/components/UI/ErrorComponent'
import Anticheat from 'frontend/components/UI/Anticheat'

import StoreLogos from 'frontend/components/UI/StoreLogos'
import { hasStatus } from 'frontend/hooks/hasStatus'
import GameContext from '../GameContext'
import { GameContextType } from 'frontend/types'
import {
  AppleWikiInfo,
  CloudSavesSync,
  CompatibilityInfo,
  Description,
  Developer,
  DotsMenu,
  DownloadSizeInfo,
  GameStatus,
  HLTB,
  InstalledInfo,
  MainButton,
  ReportIssue,
  Requirements,
  Scores,
  SettingsButton
} from './components'
import { hasAnticheatInfo } from 'frontend/hooks/hasAnticheatInfo'
import { hasHelp } from 'frontend/hooks/hasHelp'
import Genres from './components/Genres'
import ReleaseDate from './components/ReleaseDate'
import { useKnownFixes } from 'frontend/hooks/hasKnownFixes'
import { openInstallGameModal } from 'frontend/state/InstallGameModal'
import useSettingsContext from 'frontend/hooks/useSettingsContext'
import SettingsContext from 'frontend/screens/Settings/SettingsContext'
import useGlobalState from 'frontend/state/GlobalStateV2'
import Achievements from './components/Achievements'
import { LaunchOptionSelector } from 'frontend/screens/Settings/components'
import * as nk from 'frontend/nk/gameDetails' // nk: #5

const GamePage = React.memo(function GamePage(): JSX.Element | null {
  // nk: #5
  const { appName, runner } = useParams() as { appName: string; runner: Runner }
  useDetailsArt(runner, appName) // nk: #5
  const location = useLocation() as {
    state: { fromDM: boolean; gameInfo: GameInfo }
  }
  const { t, i18n } = useTranslation('gamepage')
  const { t: t2 } = useTranslation()

  const locationGameInfo = nk.useRouteGameInfo()! // nk: #5

  const [showUninstallModal, setShowUninstallModal] = useState(false)
  const [wikiInfo, setWikiInfo] = nk.useWikiInfoState(runner, appName) // nk: #5

  const { epic, gog, gameUpdates, platform, showDialogModal, connectivity } =
    useContext(ContextProvider)

  const { settingsModalProps } = useGlobalState.keys('settingsModalProps')

  hasHelp(
    'gamePage',
    t('help.title.gamePage', 'Game Page'),
    <p>
      {t(
        'help.content.gamePage',
        'Show all game details and actions. Use the 3 dots menu for more options.'
      )}
    </p>
  )

  const [gameInfo, setGameInfo] = useState(locationGameInfo)
  const [gameSettings, setGameSettings] = nk.useGameSettingsState(appName) // nk: #5

  const { status, folder, statusContext } = hasStatus(gameInfo)
  const gameAvailable = gameInfo.is_installed && status !== 'notAvailable'

  const [progress, previousProgress] = hasProgress(appName, runner)

  const [extraInfo] = nk.useExtraInfoState(gameInfo) // nk: #5
  const [achievements, setAchievements] = nk.useAchievementsState(
    runner,
    appName
  ) // nk: #5
  const hasAchievements = achievements && achievements.length > 0
  const achievementPercentage = hasAchievements
    ? Math.round(
        (achievements.filter((x) => x.date_unlocked).length /
          achievements.length) *
          100
      )
    : 0

  const [notInstallable, setNotInstallable] =
    nk.useNotInstallableState(gameInfo) // nk: #5
  const [gameInstallInfo, setGameInstallInfo] = nk.useInstallInfoState(gameInfo) // nk: #5

  const [hasError, setHasError] = useState<{
    error: boolean
    message: unknown
  }>({ error: false, message: '' })
  const [playClicked, setPlayClicked] = useState(false)

  const anticheatInfo = hasAnticheatInfo(gameInfo)

  const knownFixes = useKnownFixes(appName, runner)

  const isWin = platform === 'win32'
  const isLinux = platform === 'linux'
  const isMac = platform === 'darwin'
  const isSideloaded = runner === 'sideload'
  const isBrowserGame = gameInfo?.install.platform === 'Browser'

  const isInstalling = status === 'installing'
  const isImporting = status === 'importing'
  const isPlaying = status === 'playing'
  const isUpdating = status === 'updating'
  const isQueued = status === 'queued'
  const isReparing = status === 'repairing'
  const isMoving = status === 'moving'
  const isUninstalling = status === 'uninstalling'
  const isSyncing = status === 'syncing-saves'
  const isLaunching = status === 'launching'
  const isInstallingWinetricksPackages = status === 'winetricks'
  const isInstallingRedist = status === 'redist'
  const notAvailable = !gameAvailable && gameInfo.is_installed
  const notSupportedGame =
    gameInfo.runner !== 'sideload' &&
    !!gameInfo.thirdPartyManagedApp &&
    !gameInfo.isEAManaged &&
    !gameInfo.isUbisoftManaged
  const isOffline = connectivity.status !== 'online'
  const notPlayableOffline = isOffline && !gameInfo.canRunOffline

  const backRoute = location.state?.fromDM ? '/download-manager' : '/' // nk: #6

  const storage: Storage = window.localStorage

  const [currentTab, setCurrentTab] = useState<
    'info' | 'achievements' | 'extra' | 'requirements'
  >('info')

  useEffect(() => {
    const updateAchievements = async () => {
      setAchievements(await nk.gameDetailsApi.getAchievements(appName, runner)) // nk: #5
    }

    updateAchievements()
  }, [isPlaying, appName, setAchievements]) // nk: #5

  useEffect(() => {
    const updateGameInfo = async () => {
      if (status) {
        const newInfo = await getGameInfo(appName, runner)
        if (newInfo) {
          setGameInfo(newInfo)
        }
      }
    }
    updateGameInfo()
  }, [status, gog.library, epic.library, isMoving])

  useEffect(() => {
    const updateConfig = async () => {
      if (gameInfo && status) {
        const {
          install,
          thirdPartyManagedApp,
          is_mac_native = undefined
        } = { ...gameInfo }

        const installPlatform =
          install.platform || (is_mac_native && isMac ? 'Mac' : 'Windows')

        if (
          runner !== 'sideload' &&
          !notSupportedGame &&
          !notInstallable &&
          !thirdPartyManagedApp &&
          !isOffline
        ) {
          nk.gameDetailsApi
            .getInstallInfo(appName, runner, installPlatform) // nk: #5
            .then((info) => {
              if (!info) {
                throw new Error('Cannot get game info')
              }
              if (
                info.manifest &&
                info.manifest.disk_size === 0 &&
                info.manifest.download_size === 0
              ) {
                setNotInstallable(true)
                return
              }
              setGameInstallInfo(info)
            })
            .catch((error) => {
              console.error(error)
              window.api.logError(`${`${error}`}`)
              setHasError({ error: true, message: `${error}` })
            })
        }

        try {
          const gameSettings =
            await nk.gameDetailsApi.requestGameSettings(appName) // nk: #5
          setGameSettings(gameSettings)
        } catch (error) {
          setHasError({ error: true, message: error })
          window.api.logError(`${error}`)
        }
      }
    }
    updateConfig()
  }, [
    status,
    epic.library,
    gog.library,
    gameInfo,
    settingsModalProps.isOpen,
    isOffline,
    setGameInstallInfo,
    setGameSettings,
    setNotInstallable // nk: #5
  ])

  useEffect(() => {
    nk.gameDetailsApi
      .getWikiGameInfo(gameInfo.title, appName, runner)
      .then((info) => {
        // nk: #5
        if (
          info &&
          (info.applegamingwiki || info.howlongtobeat || info.pcgamingwiki)
        ) {
          setWikiInfo(info)
        }
      })
  }, [appName, setWikiInfo]) // nk: #5

  useEffect(() => {
    // when the user clicks the Play button, we disable it so the user can't click it again
    // once we receive the "launching" status update we can safely unset this state
    if (status === 'launching') setPlayClicked(false)
  }, [status])

  function handleUpdate() {
    if (gameInfo.runner !== 'sideload')
      updateGame({ appName, runner, gameInfo })
  }

  function handleModal() {
    openInstallGameModal({ appName, runner, gameInfo })
  }

  let hasUpdate = false

  const settingsContextValues = useSettingsContext({
    appName,
    gameInfo,
    runner
  })

  if (gameInfo && gameInfo.install && settingsContextValues) {
    const {
      runner,
      art_background,
      art_logo,
      install: { platform: installPlatform },
      is_installed
    } = gameInfo
    const title = gameInfo.overrides?.title || gameInfo.title
    const art_cover = gameInfo.overrides?.art_cover || gameInfo.art_cover

    hasUpdate = is_installed && gameUpdates?.includes(appName)

    /*
    Other Keys:
    t('box.stopInstall.title')
    t('box.stopInstall.message')
    t('box.stopInstall.keepInstalling')
    */

    if (hasError.error) {
      if (
        hasError.message !== undefined &&
        typeof hasError.message === 'string'
      )
        window.api.logError(hasError.message)
      const message =
        typeof hasError.message === 'string'
          ? hasError.message
          : t('generic.error', 'Unknown error')
      return <ErrorComponent message={message} />
    }

    const isMacNative = ['osx', 'Mac'].includes(installPlatform ?? '')
    const isLinuxNative = ['linux', 'Linux'].includes(installPlatform ?? '')

    // create setting context functions
    const contextValues: GameContextType = {
      appName,
      gameInfo,
      runner,
      gameSettings,
      gameInstallInfo,
      gameExtraInfo: extraInfo,
      is: {
        installing: isInstalling,
        importing: isImporting,
        installingWinetricksPackages: isInstallingWinetricksPackages,
        installingRedist: isInstallingRedist,
        launching: isLaunching || playClicked,
        linux: isLinux,
        linuxNative: isLinuxNative,
        mac: isMac,
        macNative: isMacNative,
        moving: isMoving,
        native: isWin || isMacNative || isLinuxNative,
        notAvailable,
        notInstallable,
        notSupportedGame,
        playing: isPlaying,
        queued: isQueued,
        reparing: isReparing,
        sideloaded: isSideloaded,
        syncing: isSyncing,
        uninstalling: isUninstalling,
        updating: isUpdating,
        win: isWin,
        notPlayableOffline: notPlayableOffline
      },
      statusContext,
      status,
      wikiInfo
    }

    const hasWikiInfo =
      wikiInfo?.applegamingwiki ||
      wikiInfo?.howlongtobeat ||
      wikiInfo?.pcgamingwiki?.metacritic.score ||
      wikiInfo?.pcgamingwiki?.opencritic.score ||
      wikiInfo?.steamInfo

    const hasRequirements = extraInfo ? extraInfo.reqs.length > 0 : false

    let wikiLink = <></>
    if (knownFixes && knownFixes.wikiLink) {
      wikiLink = (
        <p className="wikiLink">
          <Info />
          <span>
            <Trans key="wikiLink" i18n={i18n}>
              Important information about this game, read this:&nbsp;
              <Link to={knownFixes.wikiLink}>Open page</Link>
            </Trans>
          </span>
        </p>
      )
    }

    return (
      <SettingsContext.Provider value={settingsContextValues}>
        <div className="gameConfigContainer">
          {!!(art_background ?? art_cover) && (
            <CachedImage
              src={art_background || art_cover}
              className="backgroundImage"
            />
          )}
          {showUninstallModal && (
            <UninstallModal
              appName={appName}
              runner={runner}
              onClose={() => setShowUninstallModal(false)}
              isDlc={false}
            />
          )}

          {title ? (
            <>
              <GameContext.Provider value={contextValues}>
                {/* NEW DESIGN */}
                <>
                  <div className="topRowWrapper">
                    <NavLink
                      className="backButton"
                      to={backRoute}
                      title={t2('webview.controls.back', 'Go Back')}
                    >
                      <ArrowBackIosNew />
                    </NavLink>
                    <div className="topRowWapperInner">
                      <nk.RefreshButton
                        runner={runner}
                        appName={appName} /* nk: #5 */
                      />
                      {!isBrowserGame && <SettingsButton gameInfo={gameInfo} />}
                      <DotsMenu
                        gameInfo={gameInfo}
                        handleUpdate={handleUpdate}
                      />
                    </div>
                  </div>
                  <div className="mainInfoWrapper">
                    <div className="mainInfo">
                      <GamePicture
                        art_square={art_cover}
                        art_logo={art_logo}
                        store={runner}
                      />
                      <div className="store-icon">
                        <StoreLogos runner={runner} />
                      </div>

                      <h1 style={{ opacity: art_logo ? 0 : 1 }}>{title}</h1>
                      <Genres
                        genres={
                          gameInfo.extra?.genres ||
                          wikiInfo?.pcgamingwiki?.genres ||
                          []
                        }
                      />
                      <Developer gameInfo={gameInfo} />
                      <ReleaseDate
                        runnerDate={extraInfo?.releaseDate}
                        date={wikiInfo?.pcgamingwiki?.releaseDate}
                      />

                      <Description />
                      {!notInstallable && <TimeContainer gameInfo={gameInfo} />}
                      <GameStatus
                        gameInfo={gameInfo}
                        progress={progress}
                        handleUpdate={handleUpdate}
                        hasUpdate={hasUpdate}
                      />
                      <LaunchOptionSelector showTitle={false} />
                      <div className="buttons">
                        <MainButton
                          gameInfo={gameInfo}
                          handlePlay={handlePlay}
                          handleInstall={handleInstall}
                        />
                      </div>
                      {wikiLink}
                    </div>
                  </div>
                  <div className="extraInfoWrapper">
                    <div className="extraInfo">
                      <div className="extraInfoTabs">
                        <Tabs
                          className="gameInfoTabs"
                          value={currentTab}
                          onChange={(e, newVal) => setCurrentTab(newVal)}
                          aria-label="gameinfo tabs"
                          selectionFollowsFocus
                          variant="scrollable"
                          scrollButtons="auto"
                        >
                          <Tab
                            className="tabButton"
                            value={'info'}
                            label={t('game.install_info', 'Install info')}
                            iconPosition="start"
                            icon={<Info className="gameInfoTabsIcon" />}
                          />
                          {hasAchievements && (
                            <Tab
                              className="tabButton"
                              value={'achievements'}
                              label={
                                t('game.achievements', 'Achievements') +
                                ` · ${achievementPercentage}%`
                              }
                              iconPosition="start"
                              icon={
                                <EmojiEvents className="gameInfoTabsIcon" />
                              }
                            />
                          )}
                          {hasWikiInfo && (
                            <Tab
                              className="tabButton"
                              value={'extra'}
                              label={t('game.extra_info', 'Extra info')}
                              iconPosition="start"
                              icon={<Star className="gameInfoTabsIcon" />}
                            />
                          )}
                          {hasRequirements && (
                            <Tab
                              className="tabButton"
                              value={'requirements'}
                              label={t('game.requirements', 'Requirements')}
                              iconPosition="start"
                              icon={<Monitor className="gameInfoTabsIcon" />}
                            />
                          )}
                        </Tabs>
                      </div>

                      <div>
                        <TabPanel
                          value={currentTab}
                          index="achievements"
                          className="achievementsTab"
                        >
                          <Achievements appName={appName} runner={runner} />{' '}
                          {/* nk: #5 */}
                        </TabPanel>
                        <TabPanel
                          value={currentTab}
                          index="info"
                          className="infoTab"
                        >
                          <DownloadSizeInfo gameInfo={gameInfo} />
                          <InstalledInfo gameInfo={gameInfo} />
                          <CloudSavesSync gameInfo={gameInfo} />
                        </TabPanel>

                        <TabPanel
                          value={currentTab}
                          index="extra"
                          className="extraTab"
                        >
                          <Scores gameInfo={gameInfo} />
                          <HLTB />
                          <CompatibilityInfo gameInfo={gameInfo} />
                          <AppleWikiInfo gameInfo={gameInfo} />
                        </TabPanel>

                        <TabPanel
                          className="tabPanelRequirements"
                          value={currentTab}
                          index="requirements"
                        >
                          <Requirements />
                        </TabPanel>
                      </div>
                    </div>

                    <Anticheat anticheatInfo={anticheatInfo} />
                  </div>
                  <ReportIssue gameInfo={gameInfo} />
                </>
              </GameContext.Provider>
            </>
          ) : (
            <UpdateComponent />
          )}
        </div>
      </SettingsContext.Provider>
    )
  }
  return <UpdateComponent />

  async function handlePlay(gameInfo: GameInfo) {
    if (isPlaying || isUpdating) {
      return sendKill(appName, gameInfo.runner)
    }

    setPlayClicked(true)
    await launch({
      appName,
      t,
      runner: gameInfo.runner,
      hasUpdate,
      showDialogModal,
      notPlayableOffline
    })
    setPlayClicked(false)
  }

  async function handleInstall(is_installed: boolean) {
    if (isQueued) {
      storage.removeItem(appName)
      return window.api.removeFromDMQueue(appName)
    }

    if (!is_installed && !isInstalling) {
      return handleModal()
    }

    if (!folder) {
      return
    }

    if (gameInfo.runner === 'sideload') return

    return install({
      gameInfo,
      installPath: folder,
      isInstalling,
      previousProgress,
      progress,
      t,
      showDialogModal: showDialogModal
    })
  }
})

export default nk.keyedByGame(GamePage) // nk: #5
