// nk: #5 - decode only intended/open details art; disk prefetch stays separate.
import type { GameInfo } from 'common/types'
import { isImageLoaded, markImageLoaded } from 'frontend/nk/loadedImages'
import { gamePageArtUrls } from './imageUrls'
const warming = new Map<string, Promise<void>>()
export function warmDetailsArt(gameInfo: GameInfo) {
  return Promise.all(
    gamePageArtUrls(gameInfo).map((src) => {
      if (isImageLoaded(src)) return Promise.resolve()
      const pending = warming.get(src)
      if (pending) return pending
      const image = new Image()
      image.src = `imagecache://${encodeURIComponent(src)}`
      const work = image
        .decode()
        .then(() => {
          markImageLoaded(src)
        })
        .catch(() => undefined)
        .finally(() => {
          warming.delete(src)
          image.src = ''
        })
      warming.set(src, work)
      return work
    })
  )
}
