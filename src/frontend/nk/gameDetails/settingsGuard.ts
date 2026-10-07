// nk: #5 - settings edits and the cached settings.
// - Every edit writes through to the cached game settings, so the cache
//   stays exact without re-reading on open. An edit of the global defaults
//   drops every cached game settings entry (game settings merge them).
// - useSettingsContext can start a read of missing settings while a setting
//   is being edited (Settings modal): edits are counted per game, and a read
//   that started before an edit is ignored.
import type { GameSettings } from 'common/types'
import { gameDetailsApi, gameDetailsStore } from './instance'
import { settingsKey } from './types'

const edits = new Map<string, number>()

/** the edit counter of a game's settings, taken before a read */
export function settingsEditSeq(appName: string): number {
  return (
    (edits.get(appName) ?? 0) +
    (appName === 'default' ? 0 : (edits.get('default') ?? 0))
  )
}

/** whether the settings were edited since `seq` (drop the read then) */
export function settingsEditedSince(appName: string, seq: number): boolean {
  return settingsEditSeq(appName) !== seq
}

export function settingEdited(appName: string, key: string, value: unknown) {
  edits.set(appName, settingsEditSeq(appName) + 1)
  if (appName === 'default') {
    gameDetailsApi.invalidateAllSettings()
    gameDetailsStore.dropAllSettings()
    return
  }
  gameDetailsApi.invalidateSettings(appName)
  const cacheKey = settingsKey(appName)
  const cached = gameDetailsStore.getSlot<GameSettings>(cacheKey, 'settings')
  if (!cached?.data) return
  gameDetailsStore.setSlot(cacheKey, 'settings', {
    ...cached.data,
    [key]: value
  })
}
