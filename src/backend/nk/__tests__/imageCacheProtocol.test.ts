import {
  imageUrlFromRequest,
  overrideImageCacheProtocol,
  serveImageRequest
} from 'backend/nk/imageCache/protocol'

function fakeProtocol(handled = true) {
  const handlers = new Map<string, unknown>()
  if (handled) handlers.set('imagecache', 'upstream')
  return {
    handlers,
    handle: jest.fn((scheme: string, h: unknown) => {
      if (handlers.has(scheme)) throw new Error('already handled')
      handlers.set(scheme, h)
    }),
    unhandle: jest.fn((scheme: string) => handlers.delete(scheme)),
    isProtocolHandled: jest.fn((scheme: string) => handlers.has(scheme))
  }
}

describe('overrideImageCacheProtocol', () => {
  test('replaces the upstream handler', () => {
    const protocol = fakeProtocol()
    const handler = jest.fn()
    const warn = jest.fn()
    expect(overrideImageCacheProtocol(protocol, handler, warn)).toBe(true)
    expect(protocol.unhandle).toHaveBeenCalledWith('imagecache')
    expect(protocol.handlers.get('imagecache')).toBe(handler)
    expect(warn).not.toHaveBeenCalled()
  })

  test('scheme not registered by upstream: warns once, changes nothing', () => {
    const protocol = fakeProtocol(false)
    const warn = jest.fn()
    expect(overrideImageCacheProtocol(protocol, jest.fn(), warn)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(protocol.handle).not.toHaveBeenCalled()
    expect(protocol.unhandle).not.toHaveBeenCalled()
  })

  test('protocol API changed shape: warns once, changes nothing', () => {
    const warn = jest.fn()
    const protocol = { handle: jest.fn(), isProtocolHandled: () => true }
    expect(overrideImageCacheProtocol(protocol, jest.fn(), warn)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(protocol.handle).not.toHaveBeenCalled()
  })
})

describe('serveImageRequest', () => {
  const real = 'https://img.example.test/a.jpg?h=400&resize=1&w=300'
  const requestUrl = `imagecache://${encodeURIComponent(real)}`

  test('decodes the request URL', () => {
    expect(imageUrlFromRequest(requestUrl)).toBe(real)
    expect(imageUrlFromRequest('https://x')).toBeNull()
    expect(imageUrlFromRequest('imagecache://%E0%A4%A')).toBeNull()
  })

  test('serves the cached file', async () => {
    const body = new Response('img', { status: 200 })
    const deps = {
      ensure: jest.fn(async () => Promise.resolve('/cache/abc')),
      forget: jest.fn(),
      serveFile: jest.fn(async () => Promise.resolve(body))
    }
    await expect(serveImageRequest(requestUrl, deps)).resolves.toBe(body)
    expect(deps.ensure).toHaveBeenCalledWith(real)
    expect(deps.serveFile).toHaveBeenCalledWith('/cache/abc')
  })

  test('download failure answers 404', async () => {
    const deps = {
      ensure: jest.fn(async () => Promise.resolve(null)),
      forget: jest.fn(),
      serveFile: jest.fn()
    }
    const res = await serveImageRequest(requestUrl, deps)
    expect(res.status).toBe(404)
    expect(deps.serveFile).not.toHaveBeenCalled()
  })

  test('vanished file: forgotten and fetched once more', async () => {
    const ok = new Response('img', { status: 200 })
    const deps = {
      ensure: jest.fn(async () => Promise.resolve('/cache/abc')),
      forget: jest.fn(),
      serveFile: jest
        .fn()
        .mockRejectedValueOnce(new Error('ERR_FILE_NOT_FOUND'))
        .mockResolvedValueOnce(ok)
    }
    await expect(serveImageRequest(requestUrl, deps)).resolves.toBe(ok)
    expect(deps.forget).toHaveBeenCalledWith(real)
    expect(deps.ensure).toHaveBeenCalledTimes(2)
  })

  test('gives up after the second failure', async () => {
    const deps = {
      ensure: jest.fn(async () => Promise.resolve('/cache/abc')),
      forget: jest.fn(),
      serveFile: jest.fn(async () =>
        Promise.resolve(new Response(null, { status: 500 }))
      )
    }
    expect((await serveImageRequest(requestUrl, deps)).status).toBe(404)
    expect(deps.ensure).toHaveBeenCalledTimes(2)
  })
})
