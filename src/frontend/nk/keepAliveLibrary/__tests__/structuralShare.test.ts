import { structuralShare } from '../structuralShare'

const game = (appName: string, extra: Record<string, unknown> = {}) => ({
  app_name: appName,
  runner: 'legendary',
  title: `Test Game ${appName}`,
  art_square: `https://example.com/${appName}.jpg`,
  install: { is_dlc: false, platform: 'Windows' },
  is_installed: false,
  ...extra
})

const stateOf = (library: Array<ReturnType<typeof game>>) => ({
  epic: { library, username: 'user-a', login: noop },
  libraryStatus: [] as unknown[],
  refresh: noop
})

function noop() {
  return undefined
}

describe('structuralShare', () => {
  test('returns the previous value when everything is deep-equal', () => {
    const prev = stateOf([game('game-a'), game('game-b')])
    const next = stateOf([game('game-a'), game('game-b')])
    expect(structuralShare(prev, next)).toBe(prev)
  })

  test('a changed game gets the new object, unchanged games keep identity', () => {
    const prev = stateOf([game('game-a'), game('game-b'), game('game-c')])
    const next = stateOf([
      game('game-a'),
      game('game-b', { is_installed: true }),
      game('game-c')
    ])
    const shared = structuralShare(prev, next)
    expect(shared).not.toBe(prev)
    expect(shared.epic.library).not.toBe(prev.epic.library)
    expect(shared.epic.library[0]).toBe(prev.epic.library[0])
    // the changed game is new (its unchanged parts are shared)
    expect(shared.epic.library[1]).not.toBe(prev.epic.library[1])
    expect(shared.epic.library[1]).toEqual(next.epic.library[1])
    expect(shared.epic.library[1].install).toBe(prev.epic.library[1].install)
    expect(shared.epic.library[2]).toBe(prev.epic.library[2])
    // untouched siblings keep identity too
    expect(shared.libraryStatus).toBe(prev.libraryStatus)
  })

  test('matches games by store and app name when the order changes', () => {
    const prev = stateOf([game('game-a'), game('game-b')])
    const next = stateOf([game('game-new'), game('game-b'), game('game-a')])
    const shared = structuralShare(prev, next)
    expect(shared.epic.library).toHaveLength(3)
    expect(shared.epic.library[0]).toBe(next.epic.library[0])
    expect(shared.epic.library[1]).toBe(prev.epic.library[1])
    expect(shared.epic.library[2]).toBe(prev.epic.library[0])
  })

  test('the same app name in another store is a different game', () => {
    const prev = [game('game-a')]
    const next = [game('game-a', { runner: 'gog' })]
    const shared = structuralShare(prev, next)
    expect(shared[0]).toBe(next[0])
  })

  test('a removed game yields a new, shorter array', () => {
    const prev = stateOf([game('game-a'), game('game-b')])
    const next = stateOf([game('game-b')])
    const shared = structuralShare(prev, next)
    expect(shared.epic.library).toEqual([prev.epic.library[1]])
    expect(shared.epic.library[0]).toBe(prev.epic.library[1])
  })

  test('nested changes only replace the path to the change', () => {
    const prev = { a: { b: { c: 1 }, d: { e: 2 } } }
    const next = { a: { b: { c: 1 }, d: { e: 3 } } }
    const shared = structuralShare(prev, next)
    expect(shared.a).not.toBe(prev.a)
    expect(shared.a.b).toBe(prev.a.b)
    expect(shared.a.d).not.toBe(prev.a.d)
    expect(shared.a.d).toEqual({ e: 3 })
  })

  test('functions and class instances compare by identity', () => {
    class Box {
      constructor(public v: number) {}
    }
    const prev = { fn: () => 1, box: new Box(1), date: new Date(0) }
    const next = { fn: () => 1, box: new Box(1), date: new Date(0) }
    const shared = structuralShare(prev, next)
    expect(shared.fn).toBe(next.fn)
    expect(shared.box).toBe(next.box)
    expect(shared.date).toBe(next.date)
  })

  test('React-element-like objects are never rebuilt', () => {
    const el = (text: string) => ({
      $$typeof: Symbol.for('react.element'),
      props: { text }
    })
    const prev = { message: el('a') }
    const next = { message: el('a') }
    expect(structuralShare(prev, next).message).toBe(next.message)
  })

  test('added or removed keys are changes', () => {
    const prev: Record<string, number> = { a: 1 }
    expect(structuralShare(prev, { a: 1, b: 2 })).not.toBe(prev)
    const wider: Record<string, number> = { a: 1, b: 2 }
    const narrowed = structuralShare(wider, { a: 1 })
    expect(narrowed).not.toBe(wider)
    expect(narrowed).toEqual({ a: 1 })
    const withUndefined: Record<string, number | undefined> = { a: 1 }
    expect(structuralShare(withUndefined, { a: 1, b: undefined })).not.toBe(
      withUndefined
    )
  })

  test('primitives and NaN', () => {
    expect(structuralShare(1, 2)).toBe(2)
    expect(structuralShare({ n: NaN }, { n: NaN })).toEqual({ n: NaN })
    const prev = { n: NaN }
    expect(structuralShare(prev, { n: NaN })).toBe(prev)
  })
})
