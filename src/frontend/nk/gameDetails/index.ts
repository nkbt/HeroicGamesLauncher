// nk: #5 - public surface of the renderer game details cache, used by
// upstream components through single tagged lines.
export { gameDetailsApi, clearCaches } from './instance'
export {
  seedGameStatus,
  useGameStatusState,
  useAchievementsState,
  useAnticheatState,
  useExtraInfoState,
  useGameSettingsState,
  useInstallInfoState,
  useKnownFixes,
  useLaunchOptionsState,
  useLibrarySync,
  useNotInstallableState,
  useProtonDBurlState,
  useSettingsConfigState,
  useWikiInfoState
} from './hooks'
export { rememberingStatus } from './statusMemo'
export {
  settingEdited,
  settingsEditSeq,
  settingsEditedSince
} from './settingsGuard'
export { keyedByGame } from './keyedByGame'
export { default as RefreshButton } from './RefreshButton'

export { useRouteGameInfo } from './route'
