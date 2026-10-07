// nk: #5 - empty loading snapshots do not delete persisted library details.
import type { GameInfo, Runner } from 'common/types'
import type { Libraries } from './librarySync'
export function createLibraryAuthority() {
  const previous = new Map<
    Runner,
    { account: string | undefined; list: GameInfo[]; refreshed: boolean }
  >()
  let wasRefreshing = false
  return (
    libraries: Libraries,
    accounts: Partial<Record<Runner, string | undefined>>,
    refreshing: boolean
  ) => {
    const authoritative: Libraries = {}
    for (const [name, list] of Object.entries(libraries)) {
      const runner = name as Runner
      const account = accounts[runner]
      const known = previous.get(runner)
      if (refreshing) {
        if (known) authoritative[runner] = known.list
        continue
      }
      const logout =
        (!!known?.account && !account) || (runner === 'zoom' && account === '')
      const complete = wasRefreshing && known?.account === account
      if (list?.length || logout || complete || known?.refreshed) {
        const value = logout ? [] : (list ?? [])
        authoritative[runner] = value
        previous.set(runner, {
          account,
          list: value,
          refreshed: !!complete || !!known?.refreshed
        })
      } else if (known) authoritative[runner] = known.list
    }
    wasRefreshing = refreshing
    return authoritative
  }
}
