import {
  createInflight,
  guardStoreSet,
  isEmptyWikiInfo,
  replaceIpcHandler
} from 'backend/nk/gameDetails/wikiInfo'
import type { WikiInfo } from 'common/types'

const empty: WikiInfo = {
  pcgamingwiki: null,
  applegamingwiki: null,
  howlongtobeat: null,
  gamesdb: { steamID: '' },
  steamInfo: null,
  umuId: null
}

describe('createInflight', () => {
  test('concurrent calls for one key share a single fetch', async () => {
    const inflight = createInflight<string>()
    let release: (v: string) => void = () => undefined
    const fetch = jest.fn(
      async () => new Promise<string>((resolve) => (release = resolve))
    )
    const a = inflight.run('Test Game', fetch)
    const b = inflight.run('Test Game', fetch)
    expect(fetch).toHaveBeenCalledTimes(1)
    release('info')
    await expect(Promise.all([a, b])).resolves.toEqual(['info', 'info'])
    expect(inflight.size()).toBe(0)
  })

  test('different keys fetch separately; a settled key fetches again', async () => {
    const inflight = createInflight<number>()
    const fetch = jest.fn(() => Promise.resolve(1))
    await Promise.all([inflight.run('a', fetch), inflight.run('b', fetch)])
    await inflight.run('a', fetch)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  test('a rejection is shared and the entry is dropped', async () => {
    const inflight = createInflight<number>()
    const fetch = jest.fn(async () => Promise.reject(new Error('down')))
    const a = inflight.run('a', fetch)
    const b = inflight.run('a', fetch)
    await expect(a).rejects.toThrow('down')
    await expect(b).rejects.toThrow('down')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(inflight.size()).toBe(0)
  })
})

describe('isEmptyWikiInfo', () => {
  test('all sources empty', () => {
    expect(isEmptyWikiInfo(empty)).toBe(true)
    expect(isEmptyWikiInfo(null)).toBe(true)
  })
  test('any source makes it non-empty', () => {
    expect(isEmptyWikiInfo({ ...empty, gamesdb: { steamID: '10' } })).toBe(
      false
    )
    expect(
      isEmptyWikiInfo({
        ...empty,
        steamInfo: { compatibilityLevel: 'gold', steamDeckCatagory: 3 }
      })
    ).toBe(false)
    expect(
      isEmptyWikiInfo({
        ...empty,
        howlongtobeat: { mainStory: 1, mainExtra: 2, completionist: 3 }
      })
    ).toBe(false)
  })
})

describe('guardStoreSet', () => {
  test('all-empty results are not persisted, others are', () => {
    const set = jest.fn()
    const store = { set }
    expect(guardStoreSet(store, isEmptyWikiInfo, jest.fn())).toBe(true)
    store.set('Test Game', empty)
    expect(set).not.toHaveBeenCalled()
    const real = { ...empty, gamesdb: { steamID: '10' } }
    store.set('Test Game', real)
    expect(set).toHaveBeenCalledWith('Test Game', real)
  })

  test('applied once even when called twice', () => {
    const set = jest.fn()
    const store = { set }
    guardStoreSet(store, () => false, jest.fn())
    guardStoreSet(store, () => false, jest.fn())
    store.set('k', empty)
    expect(set).toHaveBeenCalledTimes(1)
  })

  test('an unexpected store shape warns and is left alone', () => {
    const warn = jest.fn()
    expect(guardStoreSet(undefined, isEmptyWikiInfo, warn)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('replaceIpcHandler', () => {
  test('removes the upstream handler and registers ours', () => {
    const calls: string[] = []
    const registry = {
      removeHandler: (c: string) => calls.push(`remove ${c}`),
      handle: (c: string) => calls.push(`handle ${c}`)
    }
    expect(
      replaceIpcHandler(registry, 'getWikiGameInfo', () => null, jest.fn())
    ).toBe(true)
    expect(calls).toEqual(['remove getWikiGameInfo', 'handle getWikiGameInfo'])
  })

  test('warns and keeps upstream when ipcMain changed shape', () => {
    const warn = jest.fn()
    expect(
      replaceIpcHandler({ handle: jest.fn() }, 'x', () => null, warn)
    ).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
