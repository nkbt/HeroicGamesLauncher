import type { GameInfo } from 'common/types'
import { warmDetailsArt } from '../art'
import { isImageLoaded } from 'frontend/nk/loadedImages'
test('intended art decodes exact protocol sources once and releases image references after settlement', async () => {
  const images: Array<{ src: string; decode: jest.Mock; resolve: () => void }> =
    []
  const OriginalImage = global.Image
  global.Image = jest.fn(() => {
    let resolve!: () => void
    const pending = new Promise<void>((yes) => {
      resolve = yes
    })
    const image = { src: '', decode: jest.fn(() => pending), resolve }
    images.push(image)
    return image
  }) as unknown as typeof Image
  const gameInfo = {
    runner: 'legendary',
    app_name: 'art-game',
    art_background: 'https://images.example/background',
    art_cover: 'https://images.example/cover-art',
    art_logo: 'https://images.example/logo-art'
  } as GameInfo
  try {
    const first = warmDetailsArt(gameInfo)
    const second = warmDetailsArt(gameInfo)
    expect(images.map((image) => image.src)).toEqual([
      `imagecache://${encodeURIComponent('https://images.example/background')}`,
      `imagecache://${encodeURIComponent('https://images.example/cover-art?h=800&resize=1&w=600')}`,
      `imagecache://${encodeURIComponent('https://images.example/logo-art?h=400&resize=1&w=300')}`
    ])
    for (const image of images) image.resolve()
    await first
    await second
    expect(images).toHaveLength(3)
    expect(
      isImageLoaded('https://images.example/cover-art?h=800&resize=1&w=600')
    ).toBe(true)
    expect(images.every((image) => image.src === '')).toBe(true)
    await warmDetailsArt(gameInfo)
    expect(images).toHaveLength(3)
  } finally {
    global.Image = OriginalImage
  }
})
