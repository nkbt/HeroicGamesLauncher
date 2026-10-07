// nk: single backend entry point for all fork code.
// Called once from src/backend/main.ts (`initNk() // nk: #3`), inside
// app.whenReady() right after initStoreManagers() and initImagesCache()
// (so the `imagecache` protocol is already registered) and before the main
// window is created. Other protocols (e.g. `heroic`, registered later in
// whenReady) and IPC handlers registered after this point do NOT exist yet:
// do not assume them here. Every fork ticket registers its backend pieces
// from here instead of adding lines to main.ts.
import { logWarning, LogPrefix } from 'backend/logger'
import { initLibraryDates } from './libraryDates'
import { initImageCache } from './imageCache'

let initialized = false

export function initNk() {
  if (initialized) return
  initialized = true

  try {
    initLibraryDates()
  } catch (error) {
    logWarning(
      ['[nk] init failed: library dates (#3)', String(error)],
      LogPrefix.Backend
    )
  }

  try {
    initImageCache()
  } catch (error) {
    logWarning(
      ['[nk] init failed: image cache (#4)', String(error)],
      LogPrefix.Backend
    )
  }
}
