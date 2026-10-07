import type { GameInfo } from 'common/types'
import { createLibraryAuthority } from '../libraryAuthority'
const gameInfo = { runner: 'gog', app_name: 'game-a' } as GameInfo
test('initial empty account snapshots remain unknown; completed refresh and logout are authoritative', () => {
  const authority = createLibraryAuthority()
  expect(authority({ gog: [] }, { gog: 'synthetic-account' }, false)).toEqual(
    {}
  )
  expect(
    authority({ gog: [gameInfo] }, { gog: 'synthetic-account' }, false).gog
  ).toEqual([gameInfo])
  expect(
    authority({ gog: [] }, { gog: 'synthetic-account' }, true).gog
  ).toEqual([gameInfo])
  expect(
    authority({ gog: [] }, { gog: 'synthetic-account' }, false).gog
  ).toEqual([])
  expect(
    authority({ gog: [gameInfo] }, { gog: 'synthetic-account' }, false).gog
  ).toEqual([gameInfo])
  expect(authority({ gog: [] }, {}, false).gog).toEqual([])
})
