import { useEffect } from 'react' // nk: #5
import { AntiCheatInfo, GameInfo } from 'common/types'
import * as nk from 'frontend/nk/gameDetails' // nk: #5

export const hasAnticheatInfo = (gameInfo: GameInfo) => {
  const [anticheatInfo, setAnticheatInfo] = nk.useAnticheatState(gameInfo) // nk: #5

  useEffect(() => {
    if (
      gameInfo.runner !== 'sideload' &&
      gameInfo.title &&
      gameInfo.namespace !== undefined
    ) {
      nk.gameDetailsApi // nk: #5
        .getAnticheatInfo(
          gameInfo.namespace,
          gameInfo.runner,
          gameInfo.app_name
        )
        .then((anticheatInfo: AntiCheatInfo | null) => {
          setAnticheatInfo(anticheatInfo)
        })
    }
  }, [
    gameInfo.namespace,
    gameInfo.runner,
    gameInfo.app_name,
    gameInfo.title,
    setAnticheatInfo
  ]) // nk: #5

  return anticheatInfo
}
