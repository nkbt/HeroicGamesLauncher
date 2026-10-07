import CacheStore from 'backend/cache'
import {
  type GameDetailsBackendStores,
  invalidateBackendCaches
} from 'backend/nk/gameDetails/invalidate'
import {
  cacheStoreKeys,
  deleteByPrefix
} from 'backend/nk/gameDetails/cacheStoreKeys'

jest.mock('electron-store')

/** a store shaped like CacheStore: keys listable through `current_store` */
function listable(keys: string[]) {
  const current_store = new Map(keys.map((key) => [key, 'value']))
  return {
    current_store,
    delete: jest.fn((key: string) => current_store.delete(key))
  }
}

function stores() {
  return {
    wikiGameInfo: { delete: jest.fn() },
    umu: { delete: jest.fn() },
    legendaryGameInfo: { delete: jest.fn() },
    legendaryInstallInfo: { delete: jest.fn() },
    gogExtraInfo: listable(['1_en', '1_de', '12_en']),
    gogAchievements: { delete: jest.fn() },
    gogInstallInfo: listable([
      '1_windows_null_undefined_',
      '1_linux_null_undefined_',
      '2_windows_null_undefined_'
    ]),
    nileInstallInfo: { delete: jest.fn() },
    zoomInstallInfo: { delete: jest.fn() }
  } satisfies GameDetailsBackendStores
}

const epic = {
  appName: 'game-a',
  runner: 'legendary' as const,
  wikiTitle: 'Test Game',
  namespace: 'ns-1'
}
const gog = { appName: '1', runner: 'gog' as const, wikiTitle: 'Test Game' }

describe('invalidateBackendCaches', () => {
  test('install scope: only the runner install info', () => {
    const s = stores()
    const result = invalidateBackendCaches(epic, 'install', s, jest.fn())
    expect(s.legendaryInstallInfo.delete).toHaveBeenCalledWith('game-a')
    expect(s.wikiGameInfo.delete).not.toHaveBeenCalled()
    expect(s.legendaryGameInfo.delete).not.toHaveBeenCalled()
    expect(result).toEqual({ dropped: ['legendary_install_info'], failed: [] })
  })

  test('meta scope: wiki title, umu, store extra info', () => {
    const s = stores()
    const result = invalidateBackendCaches(epic, 'meta', s, jest.fn())
    expect(s.wikiGameInfo.delete).toHaveBeenCalledWith('Test Game')
    expect(s.umu.delete).toHaveBeenCalledWith('legendary_game-a')
    expect(s.legendaryGameInfo.delete).toHaveBeenCalledWith('ns-1')
    expect(s.legendaryInstallInfo.delete).not.toHaveBeenCalled()
    expect(result.failed).toEqual([])
  })

  test('GOG all scope: every language, every install key, achievements; no other game', () => {
    const s = stores()
    const result = invalidateBackendCaches(gog, 'all', s, jest.fn())
    expect([...s.gogExtraInfo.current_store.keys()]).toEqual(['12_en'])
    expect([...s.gogInstallInfo.current_store.keys()]).toEqual([
      '2_windows_null_undefined_'
    ])
    expect(s.gogAchievements.delete).toHaveBeenCalledWith('1')
    expect(result.dropped.sort()).toEqual([
      'gog_achievements',
      'gog_install_info',
      'nk_gog_extra_info',
      'umu',
      'wikigameinfo'
    ])
  })

  test('sideload has no backend detail caches', () => {
    const s = stores()
    expect(
      invalidateBackendCaches(
        { appName: 'a', runner: 'sideload' },
        'all',
        s,
        jest.fn()
      )
    ).toEqual({ dropped: [], failed: [] })
  })

  test('a failing cache is reported as failed and the rest still runs', () => {
    const warn = jest.fn()
    const s = stores()
    s.umu.delete.mockImplementation(() => {
      throw new Error('io')
    })
    const result = invalidateBackendCaches(
      { appName: 'a', runner: 'nile', wikiTitle: 'Test Game' },
      'all',
      s,
      warn
    )
    expect(result.failed).toEqual(['umu'])
    expect(result.dropped.sort()).toEqual(['nile_install_info', 'wikigameinfo'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('a store whose keys cannot be listed is reported as failed', () => {
    const s = { ...stores(), gogInstallInfo: { delete: jest.fn() } }
    const result = invalidateBackendCaches(gog, 'install', s, jest.fn())
    expect(result).toEqual({ dropped: [], failed: ['gog_install_info'] })
    expect(s.gogInstallInfo.delete).not.toHaveBeenCalled()
  })
})

describe('deleteByPrefix on a real CacheStore', () => {
  const cache = new CacheStore<string>('nk_test_delete_by_prefix')
  afterEach(cache.clear)

  test('deletes matching keys and their timestamps, keeps the others', () => {
    cache.set('1_windows_null_undefined_', 'a')
    cache.set('1_linux_null_undefined_', 'b')
    cache.set('12_windows_null_undefined_', 'c')
    cache.set('2_windows_null_undefined_', 'd')
    expect(deleteByPrefix(cache, '1_')).toBe(2)
    expect(cache.has('1_windows_null_undefined_')).toBe(false)
    expect(cache.has('__timestamp.1_linux_null_undefined_')).toBe(false)
    expect(cache.get('12_windows_null_undefined_')).toBe('c')
    expect(cache.get('2_windows_null_undefined_')).toBe('d')
  })

  test('works between use_in_memory() and commit()', () => {
    cache.set('1_windows_null_undefined_', 'a')
    cache.set('2_windows_null_undefined_', 'b')
    cache.use_in_memory()
    expect(deleteByPrefix(cache, '1_')).toBe(1)
    cache.commit()
    expect(cache.has('1_windows_null_undefined_')).toBe(false)
    expect(cache.get('2_windows_null_undefined_')).toBe('b')
  })

  test('an unknown shape is reported as null', () => {
    expect(cacheStoreKeys({})).toBeNull()
    expect(deleteByPrefix({ delete: jest.fn() }, 'a')).toBeNull()
  })
})
