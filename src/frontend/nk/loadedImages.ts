// nk: #4 - session-wide registry of images that already loaded once.
// CachedImage starts these with `loaded = true`, so a remounted (or kept
// alive and re-shown) image does not replay its fade-in. Keyed on the
// original `src` prop (never the imagecache:// form or a fallback).
const loaded = new Set<string>()

export function isImageLoaded(src: string | undefined): boolean {
  return !!src && loaded.has(src)
}

export function markImageLoaded(src: string | undefined) {
  if (src) loaded.add(src)
}
