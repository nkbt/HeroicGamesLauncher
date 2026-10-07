import {
  isNavigationContextValue,
  withMemoizedCreateHref,
  type NavigationContextValue
} from '../navigationIsolation'

function makeValue() {
  const createHref = jest.fn(
    (to: string | { pathname?: string }) =>
      `#${typeof to === 'string' ? to : to.pathname}`
  )
  const navigator = { createHref, go: jest.fn(), push: jest.fn() }
  return {
    value: {
      basename: '/',
      navigator,
      static: false,
      future: {}
    } as unknown as NavigationContextValue,
    createHref
  }
}

describe('navigationIsolation', () => {
  test('shape guard', () => {
    expect(isNavigationContextValue(null)).toBe(false)
    expect(isNavigationContextValue({})).toBe(false)
    expect(isNavigationContextValue({ navigator: {} })).toBe(false)
    expect(isNavigationContextValue(makeValue().value)).toBe(true)
  })

  test('caches createHref per target path', () => {
    const { value, createHref } = makeValue()
    const memo = withMemoizedCreateHref(value, false)
    expect(memo).not.toBe(value)
    expect(memo.navigator.createHref('/gamepage/legendary/game-a')).toBe(
      '#/gamepage/legendary/game-a'
    )
    expect(memo.navigator.createHref('/gamepage/legendary/game-a')).toBe(
      '#/gamepage/legendary/game-a'
    )
    expect(
      memo.navigator.createHref({ pathname: '/gamepage/gog/game-b' })
    ).toBe('#/gamepage/gog/game-b')
    expect(createHref).toHaveBeenCalledTimes(2)
  })

  test('other navigator members still reach the original', () => {
    const { value } = makeValue()
    const memo = withMemoizedCreateHref(value, false)
    memo.navigator.go(-1)
    expect(value.navigator.go).toHaveBeenCalledWith(-1)
  })

  test('no memo with a <base href> (hrefs depend on the current URL)', () => {
    const { value } = makeValue()
    expect(withMemoizedCreateHref(value, true)).toBe(value)
  })
})
