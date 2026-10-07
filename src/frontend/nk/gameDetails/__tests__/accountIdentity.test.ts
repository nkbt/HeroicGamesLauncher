import { getAccountId } from '../account'
import { gogConfigStore } from 'frontend/helpers/electronStores'
jest.mock('frontend/helpers/electronStores', () => ({
  gogConfigStore: { get_nodefault: jest.fn() }
}))
test('a login flag and username alone never establish stable account identity', () => {
  jest
    .mocked(gogConfigStore)
    .get_nodefault.mockImplementation((key) =>
      key === 'isLoggedIn' ? true : undefined
    )
  expect(getAccountId('gog')).toBeUndefined()
})
test('known stable GOG ID is selected only while logged in; other runners do not acquire that identity', () => {
  jest
    .mocked(gogConfigStore)
    .get_nodefault.mockImplementation((key) =>
      key === 'isLoggedIn' ? true : 'synthetic-A'
    )
  expect(getAccountId('gog')).toBe('synthetic-A')
  expect(getAccountId('legendary')).toBeUndefined()
  jest
    .mocked(gogConfigStore)
    .get_nodefault.mockImplementation((key) =>
      key === 'isLoggedIn' ? false : 'synthetic-A'
    )
  expect(getAccountId('gog')).toBeUndefined()
})
