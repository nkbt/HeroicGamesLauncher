// nk: #4 - the exact image URLs library cards request, so the backend can
// warm its disk cache for every game (the cache key is sha256 of the URL:
// one character of drift is a miss). Mirrors GameCard / ConsoleCard; re-check
// after upstream merges touch GameCard/constants.ts getImageFormatting or the
// card's logo URL.
import type { GameInfo } from 'common/types'
import { getImageFormatting } from 'frontend/screens/Library/components/GameCard/constants'

const isHttp = (url: string | undefined): url is string =>
  !!url && /^https?:\/\//i.test(url)

/** card logo URL, as GameCard builds it (raw art_logo: overrides have none) */
export function cardLogoUrl(art_logo: string) {
  return `${art_logo}?h=400&resize=1&w=300`
}

/**
 * Cover (override-aware, like GameCard), the non-override cover for
 * overridden games (ConsoleCard ignores overrides) and the logo where cards
 * render it. DLCs are skipped. Deduped, http(s) only, input order kept.
 */
export function getLibraryCardImageUrls(games: GameInfo[]): string[] {
  const urls = new Set<string>()
  const add = (url: string | undefined) => {
    if (isHttp(url)) urls.add(url)
  }
  for (const gameInfo of games) {
    if (!gameInfo || gameInfo.install?.is_dlc) continue
    const { runner, art_square, art_logo, overrides } = gameInfo
    add(getImageFormatting(overrides?.art_square || art_square, runner))
    if (overrides?.art_square) add(getImageFormatting(art_square, runner))
    if (art_logo && runner !== 'nile') add(cardLogoUrl(art_logo))
  }
  return [...urls]
}

/** installed and favourite games first (stable), then the rest */
export function orderForPrefetch(
  games: GameInfo[],
  favourites: ReadonlySet<string>
): GameInfo[] {
  const first: GameInfo[] = []
  const rest: GameInfo[] = []
  for (const gameInfo of games) {
    if (gameInfo?.is_installed || favourites.has(gameInfo?.app_name)) {
      first.push(gameInfo)
    } else {
      rest.push(gameInfo)
    }
  }
  return first.concat(rest)
}

/**
 * The URLs of `urls` that are not in `sent`, in order; they are added to
 * `sent`. A repeated or reordered list returns nothing, a changed cover only
 * its new URL.
 */
export function takeUnsentUrls(sent: Set<string>, urls: string[]): string[] {
  const unsent = urls.filter((url) => !sent.has(url))
  for (const url of unsent) sent.add(url)
  return unsent
}
