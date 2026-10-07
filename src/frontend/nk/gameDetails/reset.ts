// nk: #5 - active in every renderer route, including console mode.
import type { GameDetailsStore } from './store'

interface ResetApi {
  handleResetGameDetails: (
    listener: (event: unknown, requestId: number) => void
  ) => () => void
  handleResetGameDetailsCancelled: (
    listener: (event: unknown, requestId: number) => void
  ) => () => void
  gameDetailsResetReady: (requestId: number, cleared: boolean) => void
}

export function listenToResetGameDetails(
  gameDetailsStore: GameDetailsStore,
  resetApi: ResetApi
) {
  const requests = new Map<
    number,
    { cancelled: boolean; controller: AbortController }
  >()
  let latestRequestId = 0
  const cancel = resetApi.handleResetGameDetailsCancelled(
    (_event, requestId) => {
      const request = requests.get(requestId)
      if (!request) return
      request.cancelled = true
      request.controller.abort()
      if (requestId === latestRequestId) gameDetailsStore.resumeAfterReset()
      requests.delete(requestId)
    }
  )
  const reset = resetApi.handleResetGameDetails((_event, requestId) => {
    const previous = requests.get(latestRequestId)
    if (previous) {
      previous.cancelled = true
      previous.controller.abort()
    }
    latestRequestId = requestId
    const request = { cancelled: false, controller: new AbortController() }
    requests.set(requestId, request)
    void gameDetailsStore.prepareReset(request.controller.signal).then(
      () => {
        if (request.cancelled) {
          if (requestId === latestRequestId) gameDetailsStore.resumeAfterReset()
          requests.delete(requestId)
        } else resetApi.gameDetailsResetReady(requestId, true)
      },
      () => {
        if (requestId === latestRequestId) gameDetailsStore.resumeAfterReset()
        requests.delete(requestId)
        if (!request.cancelled) resetApi.gameDetailsResetReady(requestId, false)
      }
    )
  })
  return () => {
    reset()
    cancel()
    for (const request of requests.values()) {
      request.cancelled = true
      request.controller.abort()
    }
    requests.clear()
    gameDetailsStore.resumeAfterReset()
  }
}
