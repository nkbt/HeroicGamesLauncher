// nk: #5 - Heroic's endpoint-checked state is authoritative for detail work.
interface Connectivity {
  status: string
}
interface ConnectivityApi {
  onConnectivityChanged?: (
    listener: (event: unknown, connectivity: Connectivity) => void
  ) => () => void
  getConnectivityStatus?: () => Promise<Connectivity>
}

export function createDetailsConnectivity(
  onOnline: () => void,
  onChange?: (status: string) => void
) {
  let status = 'check-online'
  let changes = 0
  function update(connectivity: Connectivity) {
    const wasOnline = status === 'online'
    status = connectivity.status
    onChange?.(status)
    if (!wasOnline && status === 'online') onOnline()
  }
  return {
    isOnline: () => status === 'online',
    listen: (connectivityApi: ConnectivityApi) => {
      const unsubscribe = connectivityApi.onConnectivityChanged?.(
        (_event, connectivity) => {
          changes++
          update(connectivity)
        }
      )
      const started = changes
      void connectivityApi
        .getConnectivityStatus?.()
        .then((connectivity) => {
          if (started === changes) update(connectivity)
        })
        .catch((error) =>
          console.warn('[nk] game details: connectivity unavailable', error)
        )
      return unsubscribe
    }
  }
}
