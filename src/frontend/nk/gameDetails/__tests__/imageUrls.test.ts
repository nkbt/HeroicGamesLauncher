import type { GameInfo } from 'common/types'
import { gamePageArtUrls } from '../imageUrls'

// pins the formats of screens/Game/GamePicture and the GamePage background
test('legendary: background, 600x800 cover and logo', () => {
  expect(
    gamePageArtUrls({
      runner: 'legendary',
      art_cover: 'https://img.example/cover.jpg',
      art_logo: 'https://img.example/logo.png'
    } as GameInfo)
  ).toEqual([
    'https://img.example/cover.jpg',
    'https://img.example/cover.jpg?h=800&resize=1&w=600',
    'https://img.example/logo.png?h=400&resize=1&w=300'
  ])
})

test('others: raw cover, background art, overrides; no duplicates', () => {
  expect(
    gamePageArtUrls({
      runner: 'gog',
      art_background: 'https://img.example/bg.jpg',
      art_cover: 'https://img.example/cover.jpg',
      overrides: { art_cover: 'https://img.example/custom.jpg' }
    } as GameInfo)
  ).toEqual(['https://img.example/bg.jpg', 'https://img.example/custom.jpg'])
  expect(
    gamePageArtUrls({
      runner: 'sideload',
      art_cover: 'fallback'
    } as GameInfo)
  ).toEqual([])
})
