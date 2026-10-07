// nk: fork-owned preload surface. Spread into `window.api` from
// src/preload/api/index.ts. Every fork IPC invoker goes here.
import type {} from 'common/types/nk/imageCache' // nk: #4 IPC typing
import { makeHandlerInvoker } from '../ipc'

// nk: #4 - warm the backend image cache for a list of image URLs
export const prefetchLibraryImages = makeHandlerInvoker('prefetchLibraryImages')
