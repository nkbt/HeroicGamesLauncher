import type { GameInfo } from 'common/types'
import { gameDetailsApi, gameDetailsStore, refreshStatus } from '../instance'
import { forgetStatus, peekStatus, subscribeStatus } from '../statusMemo'

test('availability from an older Refresh cannot restore status after an uninstall completion', async () => {
  let resolve!: (available: boolean) => void
  const available = new Promise<boolean>((release) => {
    resolve = release
  })
  window.api.isGameAvailable = jest.fn(() => available)
  const gameInfo = {
    app_name: 'game-a',
    runner: 'gog',
    is_installed: true
  } as GameInfo
  const current = gameDetailsApi.beginRefresh('gog', 'game-a')
  const notify = jest.fn()
  const unsubscribe = subscribeStatus('game-a', notify)
  const pending = refreshStatus(gameInfo, current)
  gameDetailsApi.beginRefresh('gog', 'game-a')
  forgetStatus('game-a')
  resolve(true)
  await pending
  expect(peekStatus('game-a')).toBeUndefined()
  expect(notify).not.toHaveBeenCalled()
  unsubscribe()
  await gameDetailsStore.clearAll()
})
