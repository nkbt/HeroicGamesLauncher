// nk: #4 - fork-owned types for the image cache / library image prefetch.
//
// The IPC channel is added to upstream's `AsyncIPCFunctions` through
// declaration merging, so `src/common/types/ipc.ts` stays untouched.

/**
 * Prefetch priority. `card` (library cover art) is drained before `details`
 * (game page art). Requests coming from `imagecache://` itself always go
 * first.
 */
export type ImagePrefetchTier = 'card' | 'details'

export interface ImagePrefetchResult {
  /** unique http(s) URLs in the request */
  total: number
  /** of those, already on disk */
  alreadyCached: number
  /** newly queued for download (0 while offline: the list is deferred) */
  queued: number
}

export interface ImageRefreshResult {
  /** URLs downloaded again (the new file replaced the cached one) */
  refreshed: number
  /** URLs whose download failed (a cached file is kept as it was) */
  failed: number
}

declare module 'common/types/ipc' {
  interface AsyncIPCFunctions {
    prefetchLibraryImages: (
      urls: string[],
      tier?: ImagePrefetchTier
    ) => Promise<ImagePrefetchResult>
  }
}
