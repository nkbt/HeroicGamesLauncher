// nk: #4 - read-through disk cache for remote images (cover art etc.).
//
// Pure logic with injected I/O so it can be unit-tested without Electron,
// axios or the real file system (see ./index.ts for the real wiring).
//
// - Files live in `<dir>/<sha256(url)>`, the same naming upstream's
//   images_cache.ts has always used, so an existing cache stays valid.
// - Every download goes through ONE limiter (MAX_CONCURRENT_DOWNLOADS) with
//   three FIFO lanes drained in order: `high` (an <img> is waiting on the
//   imagecache:// protocol), then `card`, then `details` (background
//   prefetch). A URL waiting in a prefetch lane is promoted when the protocol
//   asks for it; it is never downloaded twice.
// - Cached files never expire. Only `refreshImages` (explicit refresh)
//   downloads a cached URL again, replacing the file only on success.
// - Downloads are written to `<file>.part` and renamed on success; non-200
//   or non-image responses are never cached.
import { createHash } from 'crypto'
import { join } from 'path'
import type {
  ImagePrefetchResult,
  ImagePrefetchTier,
  ImageRefreshResult
} from 'common/types/nk/imageCache'

export const MAX_CONCURRENT_DOWNLOADS = 6
export const PROTOCOL_TIMEOUT_MS = 15_000
export const PREFETCH_TIMEOUT_MS = 30_000
const PREFETCH_ATTEMPTS = 2 // one retry; the protocol lane never retries
const MAX_FAILURE_LOGS_PER_BATCH = 5 // e.g. a cold cache while offline

type Lane = 'high' | ImagePrefetchTier

export interface ImageResponse {
  status: number
  contentType: string
  body: unknown
  /** release the response body without reading it */
  discard: () => void
}

export interface ImageCacheDeps {
  dir: string
  readdir: () => string[]
  request: (url: string, timeoutMs: number) => Promise<ImageResponse>
  writeBody: (body: unknown, path: string) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  unlink: (path: string) => Promise<void>
  isOnline: () => boolean
  runOnceWhenOnline: (callback: () => void) => void
  logInfo: (msg: string) => void
  logWarning: (msg: string) => void
}

interface Entry {
  url: string
  digest: string
  lane: Lane
  running: boolean
  promise: Promise<string | null>
  resolve: (path: string | null) => void
}

export interface ImageCacheStats {
  running: number
  maxRunning: number
  queued: Record<Lane, number>
  cached: number
}

export function digestOf(url: string): string {
  return createHash('sha256').update(url).digest('hex')
}

export function isHttpUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

export function isImageContentType(contentType: string): boolean {
  const type = contentType.split(';')[0].trim().toLowerCase()
  return (
    type.startsWith('image/') ||
    type === 'application/octet-stream' ||
    type === 'binary/octet-stream'
  )
}

const DIGEST_RE = /^[0-9a-f]{64}$/

export function createImageCache(deps: ImageCacheDeps) {
  const cached = new Set<string>()
  const entries = new Map<string, Entry>() // queued or running, by digest
  const lanes: Record<Lane, Entry[]> = { high: [], card: [], details: [] }
  let running = 0
  let maxRunning = 0
  let batch = { downloaded: 0, failed: 0 }

  const deferred = new Map<ImagePrefetchTier, string[]>()
  let deferRegistered = false

  const pathOf = (digest: string) => join(deps.dir, digest)

  /** Fill the digest set from the cache folder and drop stale `.part` files. */
  function init() {
    for (const name of deps.readdir()) {
      if (name.endsWith('.part')) {
        deps.unlink(pathOf(name)).catch(() => undefined)
      } else if (DIGEST_RE.test(name)) {
        cached.add(name)
      }
    }
  }

  async function downloadOnce(entry: Entry, timeoutMs: number) {
    const final = pathOf(entry.digest)
    const part = `${final}.part`
    let wrote = false
    try {
      const res = await deps.request(entry.url, timeoutMs)
      if (res.status !== 200) {
        res.discard()
        throw new Error(`HTTP ${res.status}`)
      }
      if (!isImageContentType(res.contentType)) {
        res.discard()
        throw new Error(`unexpected content-type "${res.contentType}"`)
      }
      wrote = true
      await deps.writeBody(res.body, part)
      await deps.rename(part, final)
      cached.add(entry.digest)
    } catch (error) {
      if (wrote) await deps.unlink(part).catch(() => undefined)
      throw error
    }
  }

  async function run(entry: Entry) {
    // the lane can change while queued, never while running
    const protocol = entry.lane === 'high'
    const attempts = protocol ? 1 : PREFETCH_ATTEMPTS
    const timeout = protocol ? PROTOCOL_TIMEOUT_MS : PREFETCH_TIMEOUT_MS
    for (let i = 0; i < attempts; i++) {
      try {
        await downloadOnce(entry, timeout)
        batch.downloaded++
        return pathOf(entry.digest)
      } catch {
        // Request errors can contain private URLs; only log the digest below.
      }
    }
    batch.failed++
    if (batch.failed <= MAX_FAILURE_LOGS_PER_BATCH) {
      deps.logWarning(`[nk] image cache: download failed: ${entry.digest}`)
    }
    return null
  }

  function pump() {
    while (running < MAX_CONCURRENT_DOWNLOADS) {
      const entry =
        lanes.high.shift() ?? lanes.card.shift() ?? lanes.details.shift()
      if (!entry) break
      entry.running = true
      running++
      maxRunning = Math.max(maxRunning, running)
      void run(entry)
        .catch(() => null)
        .then((path) => {
          running--
          entries.delete(entry.digest)
          entry.resolve(path)
          pump()
        })
    }
    if (running === 0 && batch.downloaded + batch.failed > 0) {
      deps.logInfo(
        `[nk] image cache: downloaded ${batch.downloaded} image(s), ${batch.failed} failed (max ${maxRunning} concurrent)`
      )
      batch = { downloaded: 0, failed: 0 }
    }
  }

  function enqueue(url: string, digest: string, lane: Lane): Entry {
    let resolve!: (path: string | null) => void
    const promise = new Promise<string | null>((r) => (resolve = r))
    const entry: Entry = { url, digest, lane, running: false, promise, resolve }
    entries.set(digest, entry)
    lanes[lane].push(entry)
    return entry
  }

  /** Moves an entry still waiting in a prefetch lane to the high lane. */
  function promote(entry: Entry) {
    if (entry.running || entry.lane === 'high') return
    const from = lanes[entry.lane]
    from.splice(from.indexOf(entry), 1)
    entry.lane = 'high'
    lanes.high.push(entry)
  }

  /**
   * Protocol path: resolves with the cached file path, downloading it first
   * (high-priority lane) when needed. Resolves null on failure; never throws.
   */
  function ensure(url: string): Promise<string | null> {
    if (!isHttpUrl(url)) return Promise.resolve(null)
    const digest = digestOf(url)
    if (cached.has(digest)) return Promise.resolve(pathOf(digest))
    const pending = entries.get(digest)
    if (pending) {
      promote(pending)
      return pending.promise
    }
    const entry = enqueue(url, digest, 'high')
    pump()
    return entry.promise
  }

  /**
   * Explicit refresh: downloads every http(s) URL again in the high lane,
   * cached or not. A download already queued or running for the same URL is
   * shared. The new file is written to `.part` and renamed over the old one;
   * when the download fails the old file stays and is still served.
   */
  async function refreshImages(urls: unknown): Promise<ImageRefreshResult> {
    const unique = Array.isArray(urls)
      ? [...new Set(urls.filter(isHttpUrl))]
      : []
    const promises = unique.map((url) => {
      const digest = digestOf(url)
      const pending = entries.get(digest)
      if (pending) {
        promote(pending)
        return pending.promise
      }
      return enqueue(url, digest, 'high').promise
    })
    pump()
    const paths = await Promise.all(promises)
    const refreshed = paths.filter((path) => path !== null).length
    return { refreshed, failed: paths.length - refreshed }
  }

  /** The cached file vanished (deleted externally): treat it as a miss. */
  function forget(url: string) {
    cached.delete(digestOf(url))
  }

  function replayDeferred() {
    deferRegistered = false
    const card = deferred.get('card')
    const details = deferred.get('details')
    deferred.clear()
    if (card) prefetch(card, 'card')
    if (details) prefetch(details, 'details')
  }

  /** Background prefetch: queue every URL that is not on disk yet. */
  function prefetch(
    urls: unknown,
    tier: unknown = 'card'
  ): ImagePrefetchResult {
    const lane: ImagePrefetchTier = tier === 'details' ? 'details' : 'card'
    const unique = Array.isArray(urls)
      ? [...new Set(urls.filter(isHttpUrl))]
      : []
    const digests = unique.map((url) => [url, digestOf(url)] as const)
    const alreadyCached = digests.filter(([, d]) => cached.has(d)).length
    const result = { total: unique.length, alreadyCached, queued: 0 }

    if (!deps.isOnline()) {
      // keep only the latest list per tier, one callback in total
      deferred.set(lane, unique)
      if (!deferRegistered) {
        deferRegistered = true
        deps.runOnceWhenOnline(replayDeferred)
      }
      return result
    }

    for (const [url, digest] of digests) {
      if (cached.has(digest) || entries.has(digest)) continue
      enqueue(url, digest, lane)
      result.queued++
    }
    deps.logInfo(
      `[nk] image prefetch (${lane}): ${result.total} image(s), ${result.alreadyCached} cached, ${result.queued} queued`
    )
    pump()
    return result
  }

  function stats(): ImageCacheStats {
    return {
      running,
      maxRunning,
      queued: {
        high: lanes.high.length,
        card: lanes.card.length,
        details: lanes.details.length
      },
      cached: cached.size
    }
  }

  return { init, ensure, forget, prefetch, refreshImages, stats, pathOf }
}

export type ImageCache = ReturnType<typeof createImageCache>
