// nk: #4 - wiring of the image cache: real I/O, the `imagecache://` handler
// override and the `prefetchLibraryImages` IPC. Called from initNk().
import { mkdirSync, readdirSync, createWriteStream } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import axios from 'axios'
import { net, protocol } from 'electron'
import { addHandler } from 'backend/ipc'
import { appFolder } from 'backend/constants/paths'
import { logInfo, logWarning, LogPrefix } from 'backend/logger'
import { isOnline, runOnceWhenOnline } from 'backend/online_monitor'
import type { ImageRefreshResult } from 'common/types/nk/imageCache'
import { createImageCache, type ImageCache } from './core'
import { overrideImageCacheProtocol, serveImageRequest } from './protocol'

// same folder upstream's images_cache.ts uses
const imagesCachePath = join(appFolder, 'images-cache')

let cache: ImageCache | null = null

export function getImageCache(): ImageCache | null {
  return cache
}

/**
 * Downloads the given image URLs again, replacing their cached files (for an
 * explicit refresh, e.g. a game page Refresh). Failed downloads keep the
 * cached file.
 */
export async function refreshImages(
  urls: string[]
): Promise<ImageRefreshResult> {
  if (!cache) return { refreshed: 0, failed: urls.length }
  return cache.refreshImages(urls)
}

export function initImageCache() {
  if (cache) return
  mkdirSync(imagesCachePath, { recursive: true })

  cache = createImageCache({
    dir: imagesCachePath,
    readdir: () => readdirSync(imagesCachePath),
    request: async (url, timeoutMs) => {
      const res = await axios.get<Readable>(url, {
        responseType: 'stream',
        timeout: timeoutMs,
        // covers the whole transfer, not only the response headers
        signal: AbortSignal.timeout(timeoutMs),
        validateStatus: () => true
      })
      return {
        status: res.status,
        contentType: String(res.headers['content-type'] ?? ''),
        body: res.data,
        discard: () => res.data.destroy()
      }
    },
    writeBody: async (body, path) =>
      pipeline(body as Readable, createWriteStream(path)),
    rename,
    unlink,
    isOnline,
    runOnceWhenOnline,
    logInfo: (msg) => logInfo(msg, LogPrefix.Backend),
    logWarning: (msg) => logWarning(msg, LogPrefix.Backend)
  })
  cache.init()
  const imageCache = cache

  overrideImageCacheProtocol(
    protocol,
    async (request) =>
      serveImageRequest(request.url, {
        ensure: imageCache.ensure,
        forget: imageCache.forget,
        serveFile: async (path) => net.fetch(pathToFileURL(path).toString())
      }),
    (msg) => logWarning(msg, LogPrefix.Backend)
  )

  addHandler('prefetchLibraryImages', (_e, urls, tier) =>
    imageCache.prefetch(urls, tier)
  )
}
