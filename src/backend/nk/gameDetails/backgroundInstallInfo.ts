// nk: #5 - background-only install transport; foreground IPC stays intact.
import { addHandler } from 'backend/ipc'
import { logError, logWarning, LogPrefix } from 'backend/logger'
import { libraryManagerMap } from 'backend/storeManagers'
import { cliSafety } from './cliSafety'
import { requestBarrier } from './requestBarrier'

let registered = false

export function initGameDetailsBackgroundInstallInfo(): boolean {
  const ready = cliSafety.install(
    {
      legendary: libraryManagerMap.legendary,
      gog: libraryManagerMap.gog,
      nile: libraryManagerMap.nile
    },
    (message) => logWarning(message, LogPrefix.Backend)
  )
  if (!registered) {
    addHandler(
      'getInstallInfoBackground',
      async (_event, appName, runner, installPlatform, build, branch) => {
        if (!cliSafety.isReady()) return null
        return requestBarrier.run(`${runner}:${appName}`, async () => {
          try {
            return await cliSafety.runBackgroundInstallInfo(async () => {
              const info = await libraryManagerMap[runner].getInstallInfo(
                appName,
                installPlatform,
                { branch, build }
              )
              return info === undefined ? null : info
            })
          } catch (error) {
            logError(
              error,
              runner === 'legendary' ? LogPrefix.Legendary : LogPrefix.Gog
            )
            return null
          }
        })
      }
    )
    registered = true
  }
  return ready
}
