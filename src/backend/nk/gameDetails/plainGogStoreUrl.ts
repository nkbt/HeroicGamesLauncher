// nk: #5 - the GOG HowLongToBeat lookup scrapes the game's store page. The
// store link upstream builds is an affiliate link (`af.gog.com?as=...`);
// scraping must not load it without the user clicking it, so the scrape uses
// the plain www.gog.com page. The store link shown to the user is unchanged.
export function plainGogStoreUrl(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'af.gog.com') parsed.hostname = 'www.gog.com'
    parsed.searchParams.delete('as')
    return parsed.toString()
  } catch {
    return url
  }
}
