// nk: #5 - the image URLs the game page requests for a game.
// keep in sync with screens/Game/GamePage/index.tsx (background) and
// screens/Game/GamePicture/index.tsx (getImageFormatting, logo).
import type { GameInfo } from 'common/types'

export function gamePageArtUrls(gameInfo: GameInfo): string[] {
  const { art_background, art_logo, runner } = gameInfo
  const artCover = gameInfo.overrides?.art_cover || gameInfo.art_cover
  const urls: string[] = []
  const background = art_background || artCover
  if (background) urls.push(background)
  if (artCover && artCover !== 'fallback') {
    urls.push(
      runner === 'legendary' ? `${artCover}?h=800&resize=1&w=600` : artCover
    )
  }
  if (art_logo) urls.push(`${art_logo}?h=400&resize=1&w=300`)
  return [...new Set(urls)].filter((url) => /^https?:\/\//.test(url))
}
