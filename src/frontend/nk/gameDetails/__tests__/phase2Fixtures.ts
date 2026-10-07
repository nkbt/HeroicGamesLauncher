import type {
  ExtraInfo,
  GameInfo,
  GameSettings,
  InstallInfo,
  WikiInfo
} from 'common/types'
import { createGameDetailsApi, type DetailsIpc } from '../api'
import { MemoryPersistence } from '../persistence'
import { createGameDetailsStore } from '../store'
import { createDetailsScheduler } from '../scheduler'
export const gameInfo = {
  runner: 'legendary',
  app_name: 'game-a',
  title: 'Synthetic Harbor',
  is_installed: false,
  install: {},
  namespace: 'synthetic',
  art_cover: 'https://images.example/cover'
} as GameInfo
export function phase2Fixture(persistence = new MemoryPersistence()) {
  let language = 'en'
  let libraryGame = gameInfo
  const ipc: DetailsIpc = {
    getExtraInfo: jest.fn(() =>
      Promise.resolve({
        storeUrl: 'https://store.example/game-a',
        about: { description: 'synthetic' }
      } as ExtraInfo)
    ),
    getWikiGameInfo: jest.fn(() =>
      Promise.resolve({ pcgamingwiki: { steamID: '123' } } as WikiInfo)
    ),
    getAchievements: jest.fn(() => Promise.resolve([])),
    requestGameSettings: jest.fn(() =>
      Promise.resolve({ wineVersion: 'synthetic' } as unknown as GameSettings)
    ),
    getAnticheatInfo: jest.fn(() => Promise.resolve(undefined)),
    getKnownFixes: jest.fn(() => Promise.resolve(undefined)),
    getLaunchOptions: jest.fn(() => Promise.resolve([])),
    clearAchievementCache: jest.fn()
  }
  const store = createGameDetailsStore(persistence)
  const scheduler = createDetailsScheduler()
  scheduler.update({ online: true })
  const getInstallInfo = jest.fn(() =>
    Promise.resolve({
      manifest: { disk_size: 5, download_size: 3 }
    } as InstallInfo)
  )
  const getInstallInfoBackground = jest.fn(() =>
    Promise.resolve({
      manifest: { disk_size: 8, download_size: 4 }
    } as InstallInfo)
  )
  const gameDetailsApi = createGameDetailsApi(store, {
    ipc: () => ipc,
    scheduler,
    getInstallInfo,
    getInstallInfoBackground,
    platform: 'linux',
    getLanguage: () => language,
    isOnline: () => true,
    getLibraryGame: () => libraryGame
  })
  return {
    store,
    scheduler,
    ipc,
    gameDetailsApi,
    getInstallInfo,
    getInstallInfoBackground,
    language: () => language,
    setLanguage: (next: string) => {
      language = next
    },
    setLibraryGame: (next: GameInfo) => {
      libraryGame = next
    }
  }
}
export async function tick() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
