import { GameInfo, Runner } from 'common/types' // nk: #5
import { SettingsContextType } from 'frontend/types'
import { useTranslation } from 'react-i18next'
import { useEffect, useContext } from 'react' // nk: #5
import ContextProvider from 'frontend/state/ContextProvider'

import useGlobalState from 'frontend/state/GlobalStateV2'
import * as nk from 'frontend/nk/gameDetails' // nk: #5

type Props = {
  appName: string
  gameInfo?: GameInfo
  runner?: Runner
}

const useSettingsContext = ({ appName, gameInfo, runner }: Props) => {
  const [currentConfig, setCurrentConfig] = nk.useSettingsConfigState(appName) // nk: #5
  const { i18n } = useTranslation()
  const { platform } = useContext(ContextProvider)
  const { settingsModalProps } = useGlobalState.keys('settingsModalProps')

  const isDefault = appName === 'default'
  const isLinux = platform === 'linux'
  const isMac = platform === 'darwin'
  const isMacNative =
    isMac &&
    (['Mac', 'osx'].includes(gameInfo?.install.platform ?? '') || false)
  const isLinuxNative =
    isLinux && (gameInfo?.install.platform === 'linux' || false)

  // Load Heroic's or game's config, only if not loaded already
  useEffect(() => {
    const getSettings = async () => {
      const editSeq = nk.settingsEditSeq(appName) // nk: #5
      const config = isDefault
        ? await window.api.requestAppSettings()
        : await nk.gameDetailsApi.requestGameSettings(appName) // nk: #5
      if (nk.settingsEditedSince(appName, editSeq)) return // nk: #5
      setCurrentConfig(config)
    }
    void getSettings()
  }, [
    appName,
    isDefault,
    i18n.language,
    settingsModalProps.isOpen,
    setCurrentConfig
  ]) // nk: #5

  const contextValues: SettingsContextType = {
    getSetting: (key, fallback) => currentConfig[key] ?? fallback,
    setSetting: (key, value) => {
      const currentValue = currentConfig[key]
      if (currentValue !== undefined || currentValue !== null) {
        const noChange = JSON.stringify(value) === JSON.stringify(currentValue)
        if (noChange) return
      }
      setCurrentConfig({ ...currentConfig, [key]: value })
      nk.settingEdited(appName, key, value) // nk: #5
      window.api.setSetting({ appName, key, value })
    },
    config: currentConfig,
    isDefault,
    appName,
    runner,
    gameInfo,
    isLinuxNative,
    isMacNative
  }

  if (Object.keys(contextValues.config).length === 0) {
    return null
  }

  return contextValues
}

export default useSettingsContext
