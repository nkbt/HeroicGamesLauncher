import {
  amazonDates,
  computeLibraryDates,
  emptyLibraryDates,
  epicNamespaceDates,
  gogGalaxyDates,
  mergeStoreDates,
  sanitiseLibraryDates
} from 'backend/nk/libraryDates/compute'
import type { GameInfo, Runner } from 'common/types'

const NOW = Date.parse('2026-10-06T12:00:00Z')

const game = (app_name: string, runner: Runner, namespace?: string) =>
  ({ app_name, runner, title: app_name, namespace }) as GameInfo

describe('computeLibraryDates', () => {
  test('first run seeds index+1 and marks the runner initialized', () => {
    const games = [game('s1', 'sideload'), game('s2', 'sideload')]
    const { next, changed } = computeLibraryDates(
      emptyLibraryDates(),
      [{ runner: 'sideload', games, storeDates: new Map() }],
      NOW
    )
    expect(changed).toBe(true)
    expect(next.dates).toEqual({
      s1_sideload: { added: 1, source: 'seed' },
      s2_sideload: { added: 2, source: 'seed' }
    })
    expect(next.initializedRunners).toEqual({ sideload: true })
  })

  test('a new undated game on an initialized runner is first-seen = now', () => {
    const first = computeLibraryDates(
      emptyLibraryDates(),
      [{ runner: 'zoom', games: [game('z1', 'zoom')], storeDates: new Map() }],
      NOW - 1000
    ).next
    const { next, changed } = computeLibraryDates(
      first,
      [
        {
          runner: 'zoom',
          games: [game('z1', 'zoom'), game('z2', 'zoom')],
          storeDates: new Map()
        }
      ],
      NOW
    )
    expect(changed).toBe(true)
    expect(next.dates.z1_zoom).toEqual({ added: 1, source: 'seed' })
    expect(next.dates.z2_zoom).toEqual({ added: NOW, source: 'first-seen' })
  })

  test('a store date overwrites an existing seed or first-seen entry', () => {
    const prev = {
      version: 1 as const,
      dates: {
        a_legendary: { added: 1, source: 'seed' as const },
        b_legendary: { added: NOW, source: 'first-seen' as const }
      },
      initializedRunners: { legendary: true as const }
    }
    const { next, changed } = computeLibraryDates(
      prev,
      [
        {
          runner: 'legendary',
          games: [game('a', 'legendary'), game('b', 'legendary')],
          storeDates: new Map([
            ['a', 1000],
            ['b', 2000]
          ])
        }
      ],
      NOW
    )
    expect(changed).toBe(true)
    expect(next.dates.a_legendary).toEqual({
      added: 1000,
      source: 'epic-entitlement'
    })
    expect(next.dates.b_legendary).toEqual({
      added: 2000,
      source: 'epic-entitlement'
    })
    // input not mutated
    expect(prev.dates.a_legendary.source).toBe('seed')
  })

  test('unchanged input gives changed === false', () => {
    const input = [
      {
        runner: 'nile' as Runner,
        games: [game('n1', 'nile'), game('n2', 'nile')],
        storeDates: new Map([['n1', 5000]])
      }
    ]
    const first = computeLibraryDates(emptyLibraryDates(), input, NOW).next
    const second = computeLibraryDates(first, input, NOW + 10)
    expect(second.changed).toBe(false)
    expect(second.next).toEqual(first)
  })

  test('keys with dots round-trip as flat keys', () => {
    const id = 'amzn1.adg.product.x'
    const { next } = computeLibraryDates(
      emptyLibraryDates(),
      [
        {
          runner: 'nile',
          games: [game(id, 'nile')],
          storeDates: new Map([[id, 1577836800123]])
        }
      ],
      NOW
    )
    expect(Object.keys(next.dates)).toEqual(['amzn1.adg.product.x_nile'])
    const roundTripped = sanitiseLibraryDates(JSON.parse(JSON.stringify(next)))
    expect(roundTripped.dates['amzn1.adg.product.x_nile']).toEqual({
      added: 1577836800123,
      source: 'amazon-entitlement'
    })
  })

  test('an empty game list does not mark the runner initialized', () => {
    const { next, changed } = computeLibraryDates(
      emptyLibraryDates(),
      [{ runner: 'gog', games: [], storeDates: new Map() }],
      NOW
    )
    expect(changed).toBe(false)
    expect(next.initializedRunners).toEqual({})
  })

  test('an empty sideload library marks sideload initialized', () => {
    const { next, changed } = computeLibraryDates(
      emptyLibraryDates(),
      [{ runner: 'sideload', games: [], storeDates: new Map() }],
      NOW
    )
    expect(changed).toBe(true)
    expect(next.initializedRunners).toEqual({ sideload: true })
  })

  test('the first sideload added to an empty, never-initialized sideload library is first-seen = now', () => {
    // store runners initialized, sideload never seen
    const prev = {
      version: 1 as const,
      dates: { old_gog: { added: 42, source: 'gog-galaxy' as const } },
      initializedRunners: { gog: true as const, legendary: true as const }
    }
    const empty = computeLibraryDates(
      prev,
      [{ runner: 'sideload', games: [], storeDates: new Map() }],
      NOW - 1000
    ).next
    const { next } = computeLibraryDates(
      empty,
      [
        {
          runner: 'sideload',
          games: [game('first', 'sideload')],
          storeDates: new Map()
        }
      ],
      NOW
    )
    expect(next.dates.first_sideload).toEqual({
      added: NOW,
      source: 'first-seen'
    })
  })

  test('an existing sideload library seen for the first time is still seeded (upgrade path)', () => {
    // apps that existed before the fork tracked dates keep the bottom seed
    const { next } = computeLibraryDates(
      emptyLibraryDates(),
      [
        {
          runner: 'sideload',
          games: [game('first', 'sideload')],
          storeDates: new Map()
        }
      ],
      NOW
    )
    expect(next.dates.first_sideload.source).toBe('seed')
  })

  test('only processes the given runners and keeps other entries', () => {
    const prev = {
      version: 1 as const,
      dates: { old_gog: { added: 42, source: 'gog-galaxy' as const } },
      initializedRunners: { gog: true as const }
    }
    const { next } = computeLibraryDates(
      prev,
      [
        {
          runner: 'sideload',
          games: [game('s', 'sideload')],
          storeDates: new Map()
        }
      ],
      NOW
    )
    expect(next.dates.old_gog).toEqual({ added: 42, source: 'gog-galaxy' })
    expect(next.dates.s_sideload).toEqual({ added: 1, source: 'seed' })
  })

  test('existing GOG Galaxy entries are kept by a GOG library update', () => {
    const merged = mergeStoreDates(
      emptyLibraryDates(),
      'gog',
      new Map([['123', 777]])
    ).next
    const { next } = computeLibraryDates(
      merged,
      [
        {
          runner: 'gog',
          games: [game('gog-redist', 'gog'), game('123', 'gog')],
          storeDates: new Map()
        }
      ],
      NOW
    )
    expect(next.dates['123_gog']).toEqual({ added: 777, source: 'gog-galaxy' })
    expect(next.dates['gog-redist_gog']).toEqual({ added: 1, source: 'seed' })
  })
})

describe('mergeStoreDates', () => {
  test('writes only when something changed', () => {
    const first = mergeStoreDates(
      emptyLibraryDates(),
      'gog',
      new Map([['1', 10]])
    )
    expect(first.changed).toBe(true)
    const second = mergeStoreDates(first.next, 'gog', new Map([['1', 10]]))
    expect(second.changed).toBe(false)
  })
})

describe('sanitiseLibraryDates', () => {
  test('handles garbage', () => {
    expect(sanitiseLibraryDates(null)).toEqual(emptyLibraryDates())
    expect(sanitiseLibraryDates('x')).toEqual(emptyLibraryDates())
    expect(
      sanitiseLibraryDates({
        dates: { a: { added: 'x' }, b_gog: { added: 5, source: 'seed' } },
        initializedRunners: { gog: true, nile: 'yes' }
      })
    ).toEqual({
      version: 1,
      dates: { b_gog: { added: 5, source: 'seed' } },
      initializedRunners: { gog: true }
    })
  })
})

describe('epicNamespaceDates', () => {
  const games = [
    game('appA', 'legendary', 'nsA'),
    game('appB', 'legendary', 'nsB'),
    game('appC', 'legendary', 'nsC'),
    game('noNs', 'legendary')
  ]

  test('takes the minimum ACTIVE grantDate per namespace', () => {
    const json = [
      {
        namespace: 'nsA',
        grantDate: '2024-05-01T00:00:00.000Z',
        status: 'ACTIVE'
      },
      {
        namespace: 'nsA',
        grantDate: '2021-01-01T00:00:00.000Z',
        status: 'ACTIVE'
      },
      {
        namespace: 'nsA',
        grantDate: '2019-01-01T00:00:00.000Z',
        status: 'REVOKED'
      },
      { namespace: 'nsB', grantDate: 'garbage', status: 'ACTIVE' },
      {
        namespace: 'nsB',
        grantDate: '2023-03-03T00:00:00.000Z',
        status: 'ACTIVE'
      },
      { namespace: 'nsC', grantDate: 'garbage', status: 'ACTIVE' },
      {
        namespace: 'other',
        grantDate: '2020-01-01T00:00:00.000Z',
        status: 'ACTIVE',
        accountId: 'account-test'
      }
    ]
    const { dates, activeEntitlements } = epicNamespaceDates(json, games, NOW)
    expect(activeEntitlements).toBe(6)
    expect(dates).toEqual(
      new Map([
        ['appA', Date.parse('2021-01-01T00:00:00.000Z')],
        ['appB', Date.parse('2023-03-03T00:00:00.000Z')]
      ])
    )
  })

  test('non-array or null input gives an empty map', () => {
    expect(epicNamespaceDates(null, games, NOW).dates.size).toBe(0)
    expect(epicNamespaceDates({}, games, NOW).dates.size).toBe(0)
    expect(epicNamespaceDates(undefined, games, NOW).activeEntitlements).toBe(0)
  })
})

describe('amazonDates', () => {
  test('parses string epoch ms and skips entries without product.id', () => {
    const json = [
      {
        entitlementDateFromEpoch: '1577836800123',
        id: 'e1',
        product: { id: 'amzn1.adg.product.one' }
      },
      { entitlementDateFromEpoch: '1577836800123', product: {} },
      { entitlementDateFromEpoch: '1577836800123' },
      {
        entitlementDateFromEpoch: null,
        product: { id: 'amzn1.adg.product.two' }
      }
    ]
    expect(amazonDates(json, NOW)).toEqual(
      new Map([['amzn1.adg.product.one', 1577836800123]])
    )
    expect(amazonDates('corrupt', NOW).size).toBe(0)
  })
})

describe('gogGalaxyDates', () => {
  test('filters platform, prefers owned_since, converts seconds, skips null/0', () => {
    const entries = [
      {
        platform_id: 'gog',
        external_id: '1',
        owned_since: 1600000000,
        date_created: 1500000000,
        certificate: 'CERT'
      },
      {
        platform_id: 'gog',
        external_id: '2',
        owned_since: null,
        date_created: 1500000000,
        certificate: 'CERT'
      },
      {
        platform_id: 'gog',
        external_id: '3',
        owned_since: 0,
        date_created: 0,
        certificate: 'CERT'
      },
      {
        platform_id: 'steam',
        external_id: '4',
        owned_since: 1600000000,
        date_created: 1600000000,
        certificate: 'CERT'
      }
    ]
    const dates = gogGalaxyDates(entries, NOW)
    expect(dates).toEqual(
      new Map([
        ['1', 1600000000000],
        ['2', 1500000000000]
      ])
    )
    expect(JSON.stringify([...dates])).not.toContain('CERT')
    const merged = mergeStoreDates(emptyLibraryDates(), 'gog', dates).next
    expect(JSON.stringify(merged)).not.toContain('CERT')
  })
})
