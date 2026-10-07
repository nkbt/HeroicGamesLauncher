import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CARD_CONTEXT_KEYS,
  CARD_LIBRARY_CONTEXT_KEYS,
  CARD_LIBRARY_KEYS,
  selectCardContext
} from '../cardContext'

describe('selectCardContext', () => {
  const gameInfo = { app_name: 'game-a' }
  const base = {
    hiddenGames: { list: [] },
    favouriteGames: { list: [] },
    connectivity: { status: 'online' },
    libraryStatus: [],
    epic: { library: [gameInfo] },
    refreshing: false,
    help: { items: {} }
  }

  it('returns the live value on the first render', () => {
    expect(selectCardContext(null, base, gameInfo)).toBe(base)
  })

  it('keeps the previous value when only keys cards do not read change', () => {
    const live = { ...base, refreshing: true, help: { items: { a: 1 } } }
    expect(selectCardContext({ value: base, gameInfo }, live, gameInfo)).toBe(
      base
    )
  })

  it('keeps the previous value when only the store libraries change', () => {
    const live = {
      ...base,
      epic: { library: [gameInfo, { app_name: 'game-b' }] }
    }
    expect(selectCardContext({ value: base, gameInfo }, live, gameInfo)).toBe(
      base
    )
  })

  it('takes the live value when a card key changes', () => {
    const live = { ...base, connectivity: { status: 'offline' } }
    expect(selectCardContext({ value: base, gameInfo }, live, gameInfo)).toBe(
      live
    )
  })

  it('takes the live value when the card gameInfo object changes', () => {
    const live = { ...base, epic: { library: [{ ...gameInfo }] } }
    expect(
      selectCardContext({ value: base, gameInfo }, live, { ...gameInfo })
    ).toBe(live)
  })

  it('checks only the given keys', () => {
    const prev = { layout: 'grid', filterText: '' }
    const typed = { layout: 'grid', filterText: 'a' }
    const keys = CARD_LIBRARY_CONTEXT_KEYS
    expect(
      selectCardContext({ value: prev, gameInfo }, typed, gameInfo, keys)
    ).toBe(prev)
    const list = { layout: 'list', filterText: '' }
    expect(
      selectCardContext({ value: prev, gameInfo }, list, gameInfo, keys)
    ).toBe(list)
  })
})

// Every component or hook rendered inside a library card that reads the
// GlobalState context. A key read here but missing from CARD_CONTEXT_KEYS
// would be stale in a card, so this guards upstream merges.
const CARD_SUBTREE_CONSUMERS = [
  'screens/Library/components/GameCard/index.tsx',
  'hooks/hasStatus.ts',
  'components/UI/UninstallModal/index.tsx',
  'components/UI/Dialog/components/Dialog.tsx',
  'components/UI/TextInputField/index.tsx',
  'components/UI/ToggleSwitch/index.tsx'
]

function contextKeysRead(source: string, context: string): string[] | null {
  const use = `(?:React\\.)?useContext\\(\\s*${context}\\s*\\)`
  const uses = source.match(new RegExp(use, 'g'))
  const destructured = [
    ...source.matchAll(new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*${use}`, 'g'))
  ]
  // a non-destructured use cannot be checked by this test
  if ((uses?.length ?? 0) !== destructured.length) return null
  return destructured.flatMap((m) =>
    m[1]
      .split(',')
      .map((part) => part.split(':')[0].trim())
      .filter(Boolean)
  )
}

const read = (file: string) =>
  readFileSync(join(__dirname, '../../..', file), 'utf8')

describe('card subtree context reads', () => {
  const allowed = new Set<string>([...CARD_CONTEXT_KEYS, ...CARD_LIBRARY_KEYS])

  it.each(CARD_SUBTREE_CONSUMERS)('%s reads only card keys', (file) => {
    const keys = contextKeysRead(read(file), 'ContextProvider')
    expect(keys).not.toBeNull()
    expect(keys!.length).toBeGreaterThan(0)
    expect(keys!.filter((key) => !allowed.has(key))).toEqual([])
  })

  it('GameCard reads only the listed LibraryContext keys', () => {
    const file = CARD_SUBTREE_CONSUMERS[0]
    const keys = contextKeysRead(read(file), 'LibraryContext')
    expect(keys).toEqual([...CARD_LIBRARY_CONTEXT_KEYS])
  })

  it.each(CARD_SUBTREE_CONSUMERS.slice(1))(
    '%s does not read LibraryContext',
    (file) => {
      expect(read(file)).not.toMatch(/useContext\(\s*LibraryContext/)
    }
  )
})
