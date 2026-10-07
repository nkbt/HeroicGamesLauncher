// nk: #5 - fork-owned types for the game details cache.
//
// The IPC channel is added to upstream's `AsyncIPCFunctions` through
// declaration merging, so `src/common/types/ipc.ts` stays untouched.
import type { Runner, InstallInfo, InstallPlatform } from 'common/types'
import type { ImageRefreshResult } from './imageCache'

/**
 * - `install`: install info (sizes) of the game
 * - `meta`: store extra info, wiki/HLTB/ProtonDB/Steam Deck data, umu id
 * - `achievements`: achievements only
 * - `all`: both, plus achievements and the given art
 */
export type InvalidateGameDetailsScope =
  | 'install'
  | 'meta'
  | 'achievements'
  | 'all'

export interface InvalidateGameDetailsRequest {
  appName: string
  runner: Runner
  scope: InvalidateGameDetailsScope
  /** art to download again (`all` only; non-http(s) URLs are ignored) */
  artUrls?: string[]
}

export interface InvalidateGameDetailsResult {
  /** backend caches the game's entries were removed from */
  dropped: string[]
  /** backend caches that could not be cleared (they may answer old data) */
  failed: string[]
  /** art downloaded again (`all` only) */
  art: ImageRefreshResult
}

declare module 'common/types/ipc' {
  interface FrontendMessages {
    resetGameDetails: (requestId: number) => void
    resetGameDetailsCancelled: (requestId: number) => void
  }
  interface SyncIPCFunctions {
    gameDetailsResetReady: (requestId: number, cleared: boolean) => void
  }
  interface AsyncIPCFunctions {
    getInstallInfoBackground: (
      appName: string,
      runner: Runner,
      installPlatform: InstallPlatform,
      build?: string,
      branch?: string
    ) => Promise<InstallInfo | null>
    invalidateGameDetailsCaches: (
      request: InvalidateGameDetailsRequest
    ) => Promise<InvalidateGameDetailsResult>
  }
}
