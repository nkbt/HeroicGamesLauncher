import {
  createImageCache,
  digestOf,
  isImageContentType,
  MAX_CONCURRENT_DOWNLOADS,
  type ImageCacheDeps,
  type ImageResponse
} from 'backend/nk/imageCache/core'

const DIR = '/cache'
const url = (i: number | string) => `https://img.example.test/${i}.jpg`

interface PendingRequest {
  url: string
  timeoutMs: number
  respond: (res?: Partial<ImageResponse>) => void
  fail: (error?: Error) => void
}

function setup(opts: { files?: string[]; online?: boolean } = {}) {
  const requests: PendingRequest[] = []
  let inFlight = 0
  let maxInFlight = 0
  const onlineCallbacks: Array<() => void> = []
  const state = { online: opts.online ?? true }
  const deps: ImageCacheDeps = {
    dir: DIR,
    readdir: () => opts.files ?? [],
    request: jest.fn(
      async (u: string, timeoutMs: number) =>
        new Promise<ImageResponse>((resolve, reject) => {
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          const done = () => inFlight--
          requests.push({
            url: u,
            timeoutMs,
            respond: (res = {}) => {
              done()
              resolve({
                status: 200,
                contentType: 'image/jpeg',
                body: 'BYTES',
                discard: jest.fn(),
                ...res
              })
            },
            fail: (error = new Error('network')) => {
              done()
              reject(error)
            }
          })
        })
    ),
    writeBody: jest.fn(async () => Promise.resolve()),
    rename: jest.fn(async () => Promise.resolve()),
    unlink: jest.fn(async () => Promise.resolve()),
    isOnline: () => state.online,
    runOnceWhenOnline: jest.fn((cb: () => void) => {
      onlineCallbacks.push(cb)
    }),
    logInfo: jest.fn(),
    logWarning: jest.fn()
  }
  const cache = createImageCache(deps)
  cache.init()
  return {
    cache,
    deps,
    requests,
    state,
    onlineCallbacks,
    maxInFlight: () => maxInFlight
  }
}

// let promise chains (request -> write -> rename -> pump) settle
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('image cache core', () => {
  test('init indexes digest files and removes leftover .part files', () => {
    const cached = digestOf(url(1))
    const { cache, deps } = setup({
      files: [cached, `${digestOf(url(2))}.part`, 'not-a-digest']
    })
    expect(cache.stats().cached).toBe(1)
    expect(deps.unlink).toHaveBeenCalledWith(`${DIR}/${digestOf(url(2))}.part`)
  })

  test('cached URL resolves to its file without a request', async () => {
    const { cache, deps } = setup({ files: [digestOf(url(1))] })
    await expect(cache.ensure(url(1))).resolves.toBe(
      `${DIR}/${digestOf(url(1))}`
    )
    expect(deps.request).not.toHaveBeenCalled()
  })

  test('non-http URLs are rejected', async () => {
    const { cache, deps } = setup()
    await expect(cache.ensure('file:///etc/passwd')).resolves.toBeNull()
    await expect(cache.ensure('heroic_card.jpg')).resolves.toBeNull()
    expect(cache.prefetch(['/local/a.png', 'fallback', 42])).toEqual({
      total: 0,
      alreadyCached: 0,
      queued: 0
    })
    expect(deps.request).not.toHaveBeenCalled()
  })

  test('successful download writes .part, renames it and indexes the digest', async () => {
    const { cache, deps, requests } = setup()
    const p = cache.ensure(url(1))
    await flush()
    requests[0].respond()
    const file = `${DIR}/${digestOf(url(1))}`
    await expect(p).resolves.toBe(file)
    expect(deps.writeBody).toHaveBeenCalledWith('BYTES', `${file}.part`)
    expect(deps.rename).toHaveBeenCalledWith(`${file}.part`, file)
    expect(cache.stats().cached).toBe(1)
    // now served from the index
    await expect(cache.ensure(url(1))).resolves.toBe(file)
    expect(deps.request).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['non-200 status', { status: 404 }],
    ['non-image content type', { contentType: 'text/html; charset=utf-8' }]
  ])('%s: no rename, resolves null, never throws', async (_name, res) => {
    const { cache, deps, requests } = setup()
    const p = cache.ensure(url(1))
    await flush()
    requests[0].respond(res)
    await expect(p).resolves.toBeNull()
    expect(deps.writeBody).not.toHaveBeenCalled()
    expect(deps.rename).not.toHaveBeenCalled()
    expect(cache.stats().cached).toBe(0)
  })

  test('a failed write removes the .part file', async () => {
    const { cache, deps, requests } = setup()
    ;(deps.writeBody as jest.Mock).mockRejectedValueOnce(new Error('disk'))
    const p = cache.ensure(url(1))
    await flush()
    requests[0].respond()
    await expect(p).resolves.toBeNull()
    expect(deps.unlink).toHaveBeenCalledWith(`${DIR}/${digestOf(url(1))}.part`)
    expect(deps.rename).not.toHaveBeenCalled()
  })

  test('failed download omits URL userinfo and private error text from logs', async () => {
    const privateUrl =
      'https://synthetic-user:synthetic-password@img.example.test/private.jpg'
    const { cache, deps, requests } = setup()
    const p = cache.ensure(privateUrl)
    await flush()
    requests[0].fail(new Error(`Request failed for ${privateUrl}`))
    await expect(p).resolves.toBeNull()
    expect(deps.logWarning).toHaveBeenCalledTimes(1)
    expect(deps.logWarning).toHaveBeenCalledWith(
      `[nk] image cache: download failed: ${digestOf(privateUrl)}`
    )
    expect(deps.logInfo).toHaveBeenCalledTimes(1)
    expect(deps.logInfo).toHaveBeenCalledWith(
      '[nk] image cache: downloaded 0 image(s), 1 failed (max 1 concurrent)'
    )
  })

  test('failed download omits signed URL query and private error text from logs', async () => {
    const privateUrl =
      'https://img.example.test/private.jpg?token=synthetic-token&X-Amz-Signature=synthetic-signature'
    const { cache, deps, requests } = setup()
    const p = cache.ensure(privateUrl)
    await flush()
    requests[0].fail(new Error(`Request failed for ${privateUrl}`))
    await expect(p).resolves.toBeNull()
    expect(deps.logWarning).toHaveBeenCalledTimes(1)
    expect(deps.logWarning).toHaveBeenCalledWith(
      `[nk] image cache: download failed: ${digestOf(privateUrl)}`
    )
    expect(deps.logInfo).toHaveBeenCalledTimes(1)
    expect(deps.logInfo).toHaveBeenCalledWith(
      '[nk] image cache: downloaded 0 image(s), 1 failed (max 1 concurrent)'
    )
  })

  test('failed download omits URL fragment and private error text from logs', async () => {
    const privateUrl =
      'https://img.example.test/private.jpg#synthetic-private-fragment'
    const { cache, deps, requests } = setup()
    const p = cache.ensure(privateUrl)
    await flush()
    requests[0].fail(new Error(`Request failed for ${privateUrl}`))
    await expect(p).resolves.toBeNull()
    expect(deps.logWarning).toHaveBeenCalledTimes(1)
    expect(deps.logWarning).toHaveBeenCalledWith(
      `[nk] image cache: download failed: ${digestOf(privateUrl)}`
    )
    expect(deps.logInfo).toHaveBeenCalledTimes(1)
    expect(deps.logInfo).toHaveBeenCalledWith(
      '[nk] image cache: downloaded 0 image(s), 1 failed (max 1 concurrent)'
    )
  })

  test('failed download omits untrusted response content type from logs', async () => {
    const { cache, deps, requests } = setup()
    const p = cache.ensure(url('private-response'))
    await flush()
    requests[0].respond({
      contentType:
        'text/html; private-url=https://img.example.test/private.jpg?token=synthetic-token'
    })
    await expect(p).resolves.toBeNull()
    expect(deps.logWarning).toHaveBeenCalledTimes(1)
    expect(deps.logWarning).toHaveBeenCalledWith(
      `[nk] image cache: download failed: ${digestOf(url('private-response'))}`
    )
  })

  test('protocol lane: one attempt, short timeout; prefetch lane: one retry', async () => {
    const { cache, deps, requests } = setup()
    const p = cache.ensure(url('p'))
    await flush()
    expect(requests[0].timeoutMs).toBe(15_000)
    requests[0].fail()
    await expect(p).resolves.toBeNull()
    expect(deps.request).toHaveBeenCalledTimes(1)

    cache.prefetch([url('q')])
    await flush()
    expect(requests[1].timeoutMs).toBe(30_000)
    requests[1].fail()
    await flush()
    expect(requests).toHaveLength(3)
    requests[2].respond()
    await flush()
    expect(cache.stats().cached).toBe(1)
  })

  test('dedupes URLs and skips already cached ones', () => {
    const { cache } = setup({ files: [digestOf(url(1))] })
    const res = cache.prefetch([url(1), url(2), url(2), url(3), 'x'])
    expect(res).toEqual({ total: 3, alreadyCached: 1, queued: 2 })
    // a second identical call queues nothing new
    expect(cache.prefetch([url(2), url(3)]).queued).toBe(0)
  })

  test(`never more than ${MAX_CONCURRENT_DOWNLOADS} downloads in flight (50 protocol + 100 prefetch)`, async () => {
    const { cache, requests, maxInFlight } = setup()
    const protocolCalls = Array.from({ length: 50 }, (_, i) =>
      cache.ensure(url(`p${i}`))
    )
    cache.prefetch(Array.from({ length: 100 }, (_, i) => url(`b${i}`)))
    await flush()
    let served = 0
    while (served < requests.length) {
      expect(requests.length - served).toBeLessThanOrEqual(
        MAX_CONCURRENT_DOWNLOADS
      )
      requests[served++].respond()
      await flush()
    }
    await Promise.all(protocolCalls)
    expect(served).toBe(150)
    expect(maxInFlight()).toBe(MAX_CONCURRENT_DOWNLOADS)
    expect(cache.stats().maxRunning).toBe(MAX_CONCURRENT_DOWNLOADS)
    expect(cache.stats().running).toBe(0)
  })

  test('high lane drains first (FIFO), then card, then details', async () => {
    const { cache, requests } = setup()
    // fill all slots with card prefetches
    cache.prefetch(Array.from({ length: 6 }, (_, i) => url(`c${i}`)))
    cache.prefetch([url('d1'), url('d2')], 'details')
    cache.prefetch([url('c6')], 'card')
    void cache.ensure(url('h1'))
    void cache.ensure(url('h2'))
    await flush()
    expect(requests.map((r) => r.url)).toEqual(
      Array.from({ length: 6 }, (_, i) => url(`c${i}`))
    )
    for (let i = 0; i < 5; i++) {
      requests[i].respond()
      await flush()
    }
    expect(requests.slice(6).map((r) => r.url)).toEqual([
      url('h1'),
      url('h2'),
      url('c6'),
      url('d1'),
      url('d2')
    ])
  })

  test('a URL waiting in a prefetch lane is promoted, not downloaded twice', async () => {
    const { cache, requests, deps } = setup()
    cache.prefetch(Array.from({ length: 6 }, (_, i) => url(`c${i}`)))
    cache.prefetch([url('later'), url('target')], 'details')
    const p = cache.ensure(url('target'))
    await flush()
    requests[0].respond()
    await flush()
    expect(requests[6].url).toBe(url('target')) // jumped ahead of 'later'
    expect(requests[6].timeoutMs).toBe(15_000) // protocol semantics
    requests[6].respond()
    await expect(p).resolves.toBe(`${DIR}/${digestOf(url('target'))}`)
    const targetCalls = (deps.request as jest.Mock).mock.calls.filter(
      ([u]) => u === url('target')
    )
    expect(targetCalls).toHaveLength(1)
  })

  test('concurrent protocol + prefetch for the same URL make one request', async () => {
    const { cache, requests, deps } = setup()
    const a = cache.ensure(url(1))
    cache.prefetch([url(1)])
    const b = cache.ensure(url(1))
    await flush()
    expect(deps.request).toHaveBeenCalledTimes(1)
    requests[0].respond()
    await expect(Promise.all([a, b])).resolves.toEqual([
      `${DIR}/${digestOf(url(1))}`,
      `${DIR}/${digestOf(url(1))}`
    ])
  })

  test('offline: deferred with one callback, latest list per tier', async () => {
    const { cache, deps, state, onlineCallbacks, requests } = setup({
      online: false
    })
    expect(cache.prefetch([url('a')]).queued).toBe(0)
    cache.prefetch([url('b')]) // replaces the pending card list
    cache.prefetch([url('d')], 'details') // must not overwrite the card list
    expect(deps.runOnceWhenOnline).toHaveBeenCalledTimes(1)
    expect(deps.request).not.toHaveBeenCalled()

    state.online = true
    onlineCallbacks[0]()
    await flush()
    expect(requests.map((r) => r.url)).toEqual([url('b'), url('d')])
  })

  test('offline: a replacement list supersedes the pending list of its tier', async () => {
    const { cache, state, onlineCallbacks, requests } = setup({
      online: false
    })
    cache.prefetch([url('old')], 'details')
    cache.prefetch([url('new')], 'details')

    state.online = true
    onlineCallbacks[0]()
    await flush()
    expect(requests.map((r) => r.url)).toEqual([url('new')])
  })

  test('refreshImages downloads a cached URL again and renames over the file', async () => {
    const { cache, deps, requests } = setup({ files: [digestOf(url(1))] })
    const file = `${DIR}/${digestOf(url(1))}`
    const p = cache.refreshImages([url(1), url(1), 'not-http'])
    await flush()
    expect(requests.map((r) => r.url)).toEqual([url(1)])
    expect(requests[0].timeoutMs).toBe(15_000) // high lane
    // the old file keeps being served while the refresh runs
    await expect(cache.ensure(url(1))).resolves.toBe(file)
    requests[0].respond()
    await expect(p).resolves.toEqual({ refreshed: 1, failed: 0 })
    expect(deps.writeBody).toHaveBeenCalledWith('BYTES', `${file}.part`)
    expect(deps.rename).toHaveBeenCalledWith(`${file}.part`, file)
    expect(cache.stats().cached).toBe(1)
  })

  test('refreshImages network error leaves the existing file untouched', async () => {
    const { cache, deps, requests } = setup({ files: [digestOf(url(1))] })
    const file = `${DIR}/${digestOf(url(1))}`
    const p = cache.refreshImages([url(1)])
    await flush()
    requests[0].fail()
    await expect(p).resolves.toEqual({ refreshed: 0, failed: 1 })
    expect(deps.request).toHaveBeenCalledTimes(1) // no retry in the high lane
    expect(deps.rename).not.toHaveBeenCalled()
    expect(deps.unlink).not.toHaveBeenCalledWith(file)
    expect(cache.stats().cached).toBe(1)
    await expect(cache.ensure(url(1))).resolves.toBe(file)
    expect(deps.request).toHaveBeenCalledTimes(1)
  })

  test('refreshImages non-200 status leaves the existing file untouched', async () => {
    const { cache, deps, requests } = setup({ files: [digestOf(url(1))] })
    const file = `${DIR}/${digestOf(url(1))}`
    const p = cache.refreshImages([url(1)])
    await flush()
    requests[0].respond({ status: 500 })
    await expect(p).resolves.toEqual({ refreshed: 0, failed: 1 })
    expect(deps.request).toHaveBeenCalledTimes(1) // no retry in the high lane
    expect(deps.rename).not.toHaveBeenCalled()
    expect(deps.unlink).not.toHaveBeenCalledWith(file)
    expect(cache.stats().cached).toBe(1)
    await expect(cache.ensure(url(1))).resolves.toBe(file)
    expect(deps.request).toHaveBeenCalledTimes(1)
  })

  test('a failed write during refreshImages removes only the .part file', async () => {
    const { cache, deps, requests } = setup({ files: [digestOf(url(1))] })
    const file = `${DIR}/${digestOf(url(1))}`
    ;(deps.writeBody as jest.Mock).mockRejectedValueOnce(new Error('disk'))
    const p = cache.refreshImages([url(1)])
    await flush()
    requests[0].respond()
    await expect(p).resolves.toEqual({ refreshed: 0, failed: 1 })
    expect(deps.unlink).toHaveBeenCalledWith(`${file}.part`)
    expect(deps.unlink).not.toHaveBeenCalledWith(file)
    expect(deps.rename).not.toHaveBeenCalled()
    expect(cache.stats().cached).toBe(1)
  })

  test('refreshImages shares a queued download and moves it to the high lane', async () => {
    const { cache, deps, requests } = setup()
    cache.prefetch(Array.from({ length: 6 }, (_, i) => url(`c${i}`)))
    cache.prefetch([url('later'), url('target')], 'details')
    const p = cache.refreshImages([url('target')])
    await flush()
    requests[0].respond()
    await flush()
    expect(requests[6].url).toBe(url('target'))
    requests[6].respond()
    await expect(p).resolves.toEqual({ refreshed: 1, failed: 0 })
    const targetCalls = (deps.request as jest.Mock).mock.calls.filter(
      ([u]) => u === url('target')
    )
    expect(targetCalls).toHaveLength(1)
  })

  test('refreshImages shares a running download of the same URL', async () => {
    const { cache, deps, requests } = setup()
    const protocol = cache.ensure(url(1))
    await flush()
    const p = cache.refreshImages([url(1)])
    await flush()
    expect(deps.request).toHaveBeenCalledTimes(1)
    requests[0].respond()
    await expect(p).resolves.toEqual({ refreshed: 1, failed: 0 })
    await expect(protocol).resolves.toBe(`${DIR}/${digestOf(url(1))}`)
  })

  test('forget() turns a vanished file into a miss', async () => {
    const { cache, deps, requests } = setup({ files: [digestOf(url(1))] })
    cache.forget(url(1))
    const p = cache.ensure(url(1))
    await flush()
    expect(deps.request).toHaveBeenCalledTimes(1)
    requests[0].respond()
    await expect(p).resolves.toBe(`${DIR}/${digestOf(url(1))}`)
  })

  test('content type check', () => {
    expect(isImageContentType('image/webp')).toBe(true)
    expect(isImageContentType('Image/JPEG; charset=binary')).toBe(true)
    expect(isImageContentType('application/octet-stream')).toBe(true)
    expect(isImageContentType('text/html')).toBe(false)
    expect(isImageContentType('')).toBe(false)
  })
})
