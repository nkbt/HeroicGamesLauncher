// nk: #4 - take over upstream's `imagecache://` scheme.
//
// Upstream registers the scheme in src/backend/images_cache.ts
// (`initImagesCache()`), but since the Electron 36 migration its handler
// answers `new Response(<file path>)`: a text/plain body containing the path,
// so every <img> errors and falls back to the network. Instead of editing
// that file we replace its handler at init (initNk runs right after
// initImagesCache and before any window exists). If upstream fixes its
// handler, delete this override.
//
// No electron import here so it can be unit-tested with a fake `protocol`.

export const IMAGECACHE_SCHEME = 'imagecache'

export interface ProtocolLike {
  handle?: unknown
  unhandle?: unknown
  isProtocolHandled?: unknown
}

type Handler = (request: Request) => Promise<Response> | Response

/**
 * Replaces the handler of an already registered `imagecache` scheme.
 * Returns false (one warning, upstream handler untouched) when the protocol
 * API changed shape or upstream no longer registers the scheme.
 */
export function overrideImageCacheProtocol(
  protocol: ProtocolLike,
  handler: Handler,
  warn: (msg: string) => void
): boolean {
  const { handle, unhandle, isProtocolHandled } = protocol
  if (
    typeof handle !== 'function' ||
    typeof unhandle !== 'function' ||
    typeof isProtocolHandled !== 'function'
  ) {
    warn('[nk] imagecache override skipped: electron protocol API changed')
    return false
  }
  if (!isProtocolHandled.call(protocol, IMAGECACHE_SCHEME)) {
    warn(
      '[nk] imagecache override skipped: upstream did not register the scheme (registration order or upstream change)'
    )
    return false
  }
  unhandle.call(protocol, IMAGECACHE_SCHEME)
  handle.call(protocol, IMAGECACHE_SCHEME, handler)
  return true
}

/** `imagecache://<encodeURIComponent(url)>` -> original URL */
export function imageUrlFromRequest(requestUrl: string): string | null {
  const prefix = `${IMAGECACHE_SCHEME}://`
  if (!requestUrl.startsWith(prefix)) return null
  try {
    return decodeURIComponent(requestUrl.slice(prefix.length))
  } catch {
    return null
  }
}

export interface ServeDeps {
  ensure: (url: string) => Promise<string | null>
  forget: (url: string) => void
  /** serve a local file (net.fetch of its file:// URL) */
  serveFile: (path: string) => Promise<Response>
}

const notFound = () => new Response(null, { status: 404 })

/**
 * Read-through: serve from disk, downloading first on a miss. A file that
 * vanished from disk is dropped from the cache index and fetched once more.
 * A failed download answers 404 so CachedImage falls back to the raw URL.
 */
export async function serveImageRequest(
  requestUrl: string,
  deps: ServeDeps
): Promise<Response> {
  const url = imageUrlFromRequest(requestUrl)
  if (url === null) return notFound()
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await deps.ensure(url)
    if (!file) return notFound()
    try {
      const res = await deps.serveFile(file)
      if (res.ok) return res
    } catch {
      // fall through: treat as a miss once
    }
    deps.forget(url)
  }
  return notFound()
}
