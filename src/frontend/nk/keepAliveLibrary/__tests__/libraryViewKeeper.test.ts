import { createLibraryViewKeeper } from '../libraryViewKeeper'

describe('nk/keepAliveLibrary libraryViewKeeper', () => {
  test('first activation seeds the saved offset and leaves scroll alone', () => {
    const k = createLibraryViewKeeper()
    expect(k.activate('k1', 1234)).toBeNull()
    expect(k.isActive()).toBe(true)
    expect(k.savedScroll()).toBe(1234)
  })

  test('re-activation without any Library scroll returns the seeded offset, not null', () => {
    const k = createLibraryViewKeeper()
    expect(k.activate('k1', 0)).toBeNull()
    k.deactivate()
    k.onScroll(800) // GamePage scrolled
    expect(k.activate('k2', 800)).toBe(0)
  })

  test('scroll events while hidden are ignored', () => {
    const k = createLibraryViewKeeper()
    k.activate('k1', 0)
    k.onScroll(500)
    k.deactivate()
    expect(k.isActive()).toBe(false)
    k.onScroll(40) // other page / clamp after hiding
    expect(k.savedScroll()).toBe(500)
    expect(k.activate('k2', 40)).toBe(500)
  })

  test('new location key while active (sidebar re-click) scrolls to top', () => {
    const k = createLibraryViewKeeper()
    k.activate('k1', 0)
    k.onScroll(900)
    expect(k.activate('k3', 900)).toBe(0)
    expect(k.savedScroll()).toBe(0)
  })

  test('same location key while active is a no-op', () => {
    const k = createLibraryViewKeeper()
    k.activate('k1', 10)
    k.onScroll(300)
    expect(k.activate('k1', 300)).toBeNull()
    expect(k.savedScroll()).toBe(300)
  })

  test('onScroll before the first activation is ignored', () => {
    const k = createLibraryViewKeeper()
    k.onScroll(700)
    expect(k.savedScroll()).toBeNull()
    expect(k.isActive()).toBe(false)
  })

  test('several cycles keep the latest active offset', () => {
    const k = createLibraryViewKeeper()
    k.activate('a', 0)
    k.onScroll(100)
    k.deactivate()
    k.onScroll(5)
    expect(k.activate('b', 5)).toBe(100)
    k.onScroll(250)
    k.onScroll(260)
    k.deactivate()
    k.onScroll(0)
    expect(k.activate('c', 0)).toBe(260)
    k.deactivate()
    expect(k.activate('d', 999)).toBe(260)
  })

  test('re-activation with the same key as before hiding still restores', () => {
    // history POP back to the very same entry key
    const k = createLibraryViewKeeper()
    k.activate('k1', 0)
    k.onScroll(420)
    k.deactivate()
    expect(k.activate('k1', 0)).toBe(420)
  })
})
