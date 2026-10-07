// nk: fork-owned preload surface. Spread into `window.api` from
// src/preload/api/index.ts. Every fork IPC invoker goes here.
import type {} from 'common/types/nk/imageCache' // nk: #4 IPC typing
import type {} from 'common/types/nk/gameDetails' // nk: #5 IPC typing
import { frontendListenerSlot, makeHandlerInvoker, makeListenerCaller } from '../ipc'

// nk: #4 - warm the backend image cache for a list of image URLs
export const prefetchLibraryImages = makeHandlerInvoker('prefetchLibraryImages')

// nk: #5 - drop one game's backend detail caches (Refresh, local events)
export const invalidateGameDetailsCaches = makeHandlerInvoker('invalidateGameDetailsCaches')

// nk: #5 - reset waits for renderer persistence before relaunch.
export const handleResetGameDetails = frontendListenerSlot('resetGameDetails')
export const gameDetailsResetReady = makeListenerCaller('gameDetailsResetReady')

export const handleResetGameDetailsCancelled = frontendListenerSlot('resetGameDetailsCancelled')

// nk: #5 - missing uninstalled details use the paced background transport.
export const getInstallInfoBackground = makeHandlerInvoker('getInstallInfoBackground')

export const getAchievementsForAccount = makeHandlerInvoker('getAchievementsForAccount')
