import {
  wrapGalaxyLibraryFetch,
  wrapLibraryRefresh
} from 'backend/nk/libraryDates/hooks'
import type { Runner } from 'common/types'

class FakeManager {
  calls = 0
  constructor(private readonly fail = false) {}
  async refresh() {
    this.calls++
    await Promise.resolve()
    if (this.fail) throw new Error('boom')
    return { stdout: 'ok', stderr: '' }
  }
}

function fakeMap(failGog = false) {
  return {
    legendary: new FakeManager(),
    gog: new FakeManager(failGog),
    nile: new FakeManager(),
    sideload: new FakeManager(),
    zoom: new FakeManager()
  }
}

describe('wrapLibraryRefresh', () => {
  test('calls onRefreshed after each refresh and passes the result through', async () => {
    const map = fakeMap()
    const seen: Runner[] = []
    const warn = jest.fn()
    expect(wrapLibraryRefresh(map, (r) => seen.push(r), warn)).toHaveLength(5)
    expect(warn).not.toHaveBeenCalled()

    await expect(map.legendary.refresh()).resolves.toEqual({
      stdout: 'ok',
      stderr: ''
    })
    expect(map.legendary.calls).toBe(1) // `this` preserved
    await Promise.allSettled(Object.values(map).map((m) => m.refresh()))
    expect(seen.sort()).toEqual(
      ['legendary', 'legendary', 'gog', 'nile', 'sideload', 'zoom'].sort()
    )
  })

  test('runs after a rejected refresh and keeps the rejection', async () => {
    const map = fakeMap(true)
    const seen: Runner[] = []
    wrapLibraryRefresh(map, (r) => seen.push(r), jest.fn())
    await expect(map.gog.refresh()).rejects.toThrow('boom')
    expect(seen).toEqual(['gog'])
  })

  test('an updater exception never breaks the refresh', async () => {
    const map = fakeMap()
    const warn = jest.fn()
    wrapLibraryRefresh(
      map,
      () => {
        throw new Error('disk full')
      },
      warn
    )
    await expect(map.nile.refresh()).resolves.toBeDefined()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('does not double-wrap', async () => {
    const map = fakeMap()
    const onRefreshed = jest.fn()
    wrapLibraryRefresh(map, onRefreshed, jest.fn())
    wrapLibraryRefresh(map, onRefreshed, jest.fn())
    await map.zoom.refresh()
    expect(onRefreshed).toHaveBeenCalledTimes(1)
  })

  test('missing targets log one warning and are left alone', () => {
    const map = { legendary: new FakeManager(), gog: {} }
    const warn = jest.fn()
    const wrapped = wrapLibraryRefresh(map, jest.fn(), warn)
    expect(wrapped).toEqual(['legendary'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[nk]'))
    expect(map.gog).toEqual({})
  })
})

class FakeGog {
  pages: Record<string, { items: unknown[]; next?: string }> = {
    first: { items: [{ external_id: '1' }], next: 'p2' },
    p2: { items: [{ external_id: '2' }] }
  }
  failPage2 = false
  async getGalaxyLibrary(page_token?: string): Promise<unknown[]> {
    const page = this.pages[page_token ?? 'first']
    if (page_token && this.failPage2) return []
    const out = [...page.items]
    if (page.next) {
      const rest = await this.getGalaxyLibrary(page.next)
      if (!rest.length) return []
      out.push(...rest)
    }
    return out
  }
  async refresh() {
    return this.getGalaxyLibrary()
  }
}

describe('wrapGalaxyLibraryFetch', () => {
  test('hands the complete list to onEntries once per top-level call', async () => {
    const gog = new FakeGog()
    const onEntries = jest.fn()
    expect(wrapGalaxyLibraryFetch(gog, onEntries, jest.fn())).toBe(true)
    const result = await gog.refresh()
    expect(result).toHaveLength(2)
    expect(onEntries).toHaveBeenCalledTimes(1)
    expect(onEntries).toHaveBeenCalledWith(result)
  })

  test('a failed page (empty result) is not recorded', async () => {
    const gog = new FakeGog()
    gog.failPage2 = true
    const onEntries = jest.fn()
    wrapGalaxyLibraryFetch(gog, onEntries, jest.fn())
    await expect(gog.refresh()).resolves.toEqual([])
    expect(onEntries).not.toHaveBeenCalled()
  })

  test('a recording error does not affect the fetch', async () => {
    const gog = new FakeGog()
    const warn = jest.fn()
    wrapGalaxyLibraryFetch(
      gog,
      () => {
        throw new Error('x')
      },
      warn
    )
    await expect(gog.refresh()).resolves.toHaveLength(2)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('missing or changed target warns and returns false', () => {
    const warn = jest.fn()
    expect(wrapGalaxyLibraryFetch({}, jest.fn(), warn)).toBe(false)
    expect(
      wrapGalaxyLibraryFetch(
        { getGalaxyLibrary: (a: string, b: string) => [a, b] },
        jest.fn(),
        warn
      )
    ).toBe(false)
    expect(wrapGalaxyLibraryFetch(undefined, jest.fn(), warn)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(3)
  })
})
