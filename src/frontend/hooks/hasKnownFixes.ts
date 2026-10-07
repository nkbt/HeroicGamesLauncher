import { Runner } from 'common/types'
import * as nk from 'frontend/nk/gameDetails' // nk: #5

export const useKnownFixes = (appName: string, runner: Runner) => {
  return nk.useKnownFixes(appName, runner) // nk: #5
}
