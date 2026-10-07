// nk: #5 - stable identity for the only account-sensitive detail source.
import type { Runner } from 'common/types'
import { gogConfigStore } from 'frontend/helpers/electronStores'

export function getAccountId(runner: Runner): string | undefined {
  if (runner !== 'gog' || !gogConfigStore.get_nodefault('isLoggedIn')) return
  const accountId = gogConfigStore.get_nodefault('userData.id')
  return typeof accountId === 'string' && accountId.length
    ? accountId
    : undefined
}
