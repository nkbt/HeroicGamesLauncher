// nk: #5 - wait for the originating renderer to clear its persistent details
// before invoking the existing destructive reset operation.
interface ResetFrame {
  url: string
  origin: string
  frameToken: string
  detached: boolean
  send: (channel: string, requestId: number) => void
}
type ResetSender = Pick<
  import('electron').WebContents,
  'mainFrame' | 'isDestroyed' | 'on' | 'removeListener'
>
interface ResetEvent {
  sender: ResetSender
  senderFrame: ResetFrame | null
}
interface ResetOptions {
  getMainWindow: () => { webContents: ResetSender } | null | undefined
  rendererEntry: string
  beforeReset?: () => void
  resetFailed?: () => void
  timeoutMs?: number
}
interface ResetRegistry {
  listeners: (channel: string) => Array<(...args: never[]) => unknown>
  removeListener: (
    channel: string,
    listener: (...args: never[]) => unknown
  ) => unknown
  on: (channel: string, listener: (...args: never[]) => unknown) => unknown
}

const guarded = new WeakMap<ResetRegistry, boolean>()

export function guardResetHeroic(
  registry: ResetRegistry,
  warn: (message: string) => void,
  {
    getMainWindow,
    rendererEntry,
    beforeReset,
    resetFailed,
    timeoutMs = 10000
  }: ResetOptions
) {
  if (guarded.has(registry)) return guarded.get(registry)!
  const originals = registry.listeners('resetHeroic')
  for (const original of originals)
    registry.removeListener('resetHeroic', original)
  if (originals.length !== 1) {
    registry.on('resetHeroic', (() =>
      warn('[nk] game details: reset disabled: unexpected listeners')) as never)
    guarded.set(registry, false)
    warn('[nk] game details: cannot guard resetHeroic: unexpected listeners')
    return false
  }
  const original = originals[0]
  let nextRequestId = 0
  let pending:
    | {
        event: ResetEvent
        args: unknown[]
        requestId: number
        timer: ReturnType<typeof setTimeout>
        frame: ResetFrame
        frameToken: string
        origin: string
        cleanup: () => void
      }
    | undefined
  const entry = new URL(rendererEntry)
  entry.hash = ''
  function trusted(event: ResetEvent) {
    if (
      event.sender !== getMainWindow()?.webContents ||
      event.sender.isDestroyed()
    )
      return false
    const frame = event.senderFrame
    if (!frame || frame.detached || frame !== event.sender.mainFrame)
      return false
    try {
      const url = new URL(frame.url)
      url.hash = ''
      return url.href === entry.href
    } catch {
      return false
    }
  }
  registry.on('resetHeroic', function (event: ResetEvent, ...args: unknown[]) {
    if (pending || !trusted(event)) return
    const frame = event.senderFrame!
    const requestId = ++nextRequestId
    const cancel = () => {
      if (pending?.requestId !== requestId) return
      const request = pending
      pending = undefined
      clearTimeout(request.timer)
      request.cleanup()
      try {
        frame.send('resetGameDetailsCancelled', requestId)
      } catch {
        /* document gone */
      }
      warn(
        '[nk] game details: reset cancelled: originating document unavailable or clear timed out'
      )
    }
    const navigation = ((details: {
      isMainFrame: boolean
      isSameDocument: boolean
    }) => {
      if (details.isMainFrame && !details.isSameDocument) cancel()
    }) as never
    const gone = cancel as never
    event.sender.on('did-start-navigation', navigation)
    event.sender.on('destroyed', gone)
    event.sender.on('render-process-gone', gone)
    const cleanup = () => {
      event.sender.removeListener('did-start-navigation', navigation)
      event.sender.removeListener('destroyed', gone)
      event.sender.removeListener('render-process-gone', gone)
    }
    const timer = setTimeout(cancel, timeoutMs)
    pending = {
      event,
      args,
      requestId,
      timer,
      frame,
      frameToken: frame.frameToken,
      origin: frame.origin,
      cleanup
    }
    try {
      frame.send('resetGameDetails', requestId)
    } catch {
      cancel()
    }
  } as never)
  registry.on('gameDetailsResetReady', function (
    event: ResetEvent,
    requestId: number,
    cleared: boolean
  ) {
    if (
      !pending ||
      event.sender !== pending.event.sender ||
      requestId !== pending.requestId ||
      !trusted(event) ||
      event.senderFrame !== pending.frame ||
      event.senderFrame.frameToken !== pending.frameToken ||
      event.senderFrame.origin !== pending.origin
    )
      return
    const request = pending
    clearTimeout(request.timer)
    request.cleanup()
    pending = undefined
    if (cleared !== true) {
      warn(
        '[nk] game details: reset cancelled: renderer persistence could not be cleared'
      )
      return
    }
    try {
      beforeReset?.()
      original.call(
        registry,
        request.event as never,
        ...(request.args as never[])
      )
    } catch (error) {
      resetFailed?.()
      try {
        request.frame.send('resetGameDetailsCancelled', requestId)
      } catch {
        /* the originating window may have closed */
      }
      throw error
    }
  } as never)
  guarded.set(registry, true)
  return true
}
