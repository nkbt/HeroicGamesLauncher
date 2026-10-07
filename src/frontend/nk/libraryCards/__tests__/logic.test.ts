import {
  isStatusTransition,
  lazyMenuMounted,
  resolveFollowed,
  sameGameStatus,
  skipUnchangedStatus
} from 'frontend/nk/libraryCards/logic'
import { isImageLoaded, markImageLoaded } from 'frontend/nk/loadedImages'

describe('resolveFollowed', () => {
  test('fetched value wins only for the prop it was fetched for', () => {
    const propA = { v: 'a' }
    const fetched = { from: propA, value: { v: 'a-fetched' } }
    expect(resolveFollowed(null, propA)).toBe(propA)
    expect(resolveFollowed(fetched, propA)).toBe(fetched.value)
    const propB = { v: 'b' } // library refresh: new object
    expect(resolveFollowed(fetched, propB)).toBe(propB)
  })
})

describe('isStatusTransition', () => {
  test('initial resolution and no-ops are not transitions', () => {
    expect(isStatusTransition(undefined, 'notInstalled')).toBe(false)
    expect(isStatusTransition('installed', 'installed')).toBe(false)
    expect(isStatusTransition('installing', 'installed')).toBe(true)
    expect(isStatusTransition('installed', 'notInstalled')).toBe(true)
  })
})

describe('skipUnchangedStatus', () => {
  test('keeps the previous object when nothing changed', () => {
    let state = { status: 'installed', label: 'Installed' }
    const setState = jest.fn((update: (prev: typeof state) => typeof state) => {
      state = update(state)
    })
    const set = skipUnchangedStatus(setState)
    const before = state
    set({ status: 'installed', label: 'Installed' })
    expect(state).toBe(before)
    const next = { status: 'installed', label: 'Installed (1 GB)' }
    set(next)
    expect(state).toBe(next)
    expect(
      sameGameStatus({ label: '', folder: 'x' }, { label: '', folder: 'y' })
    ).toBe(false)
  })
})

describe('lazyMenuMounted', () => {
  test('mounted while open and until the close transition ends', () => {
    let s = { wasOpen: false, exiting: false }
    let r = lazyMenuMounted(false, s)
    expect(r.mounted).toBe(false)
    r = lazyMenuMounted(true, s)
    expect(r.mounted).toBe(true)
    s = r
    r = lazyMenuMounted(false, s) // closing: keep it for the animation
    expect(r).toEqual({ wasOpen: false, exiting: true, mounted: true })
    s = { ...r, exiting: false } // onExited
    expect(lazyMenuMounted(false, s).mounted).toBe(false)
    // reopened while exiting
    expect(lazyMenuMounted(true, { wasOpen: false, exiting: true })).toEqual({
      wasOpen: true,
      exiting: false,
      mounted: true
    })
  })
})

describe('loadedImages', () => {
  test('remembers loaded sources', () => {
    expect(isImageLoaded('https://img.example.test/a.jpg')).toBe(false)
    markImageLoaded('https://img.example.test/a.jpg')
    markImageLoaded(undefined)
    expect(isImageLoaded('https://img.example.test/a.jpg')).toBe(true)
    expect(isImageLoaded(undefined)).toBe(false)
  })
})
