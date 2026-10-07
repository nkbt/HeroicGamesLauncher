// nk: #5 - local events that change a game's cached details.
// `libraryStatus` never contains `done` (GlobalState removes the entry), so
// the raw `gameStatusUpdate` IPC event is watched, remembering the previous
// status per game:
// - an install / update / repair / move / uninstall / import / extract that
//   finishes (`done` or `error`) changes the game's install info, launch
//   options and settings;
// - a play session that ends changes its achievements (and settings).
import type { GameStatus, Status } from 'common/types'

const CHANGING: ReadonlySet<Status> = new Set<Status>([
  'installing',
  'updating',
  'repairing',
  'moving',
  'uninstalling',
  'importing',
  'extracting'
])

export type StatusChange = 'installChanged' | 'played'

/** Pure state machine: feed it status events, get back what changed. */
export function createStatusTracker() {
  const previous = new Map<string, Status>()
  return ({
    appName,
    runner,
    status
  }: Pick<
    GameStatus,
    'appName' | 'runner' | 'status'
  >): StatusChange | null => {
    const key = runner ? `${runner}:${appName}` : appName
    const before = previous.get(key)
    previous.set(key, status)
    if (before === undefined || before === status) return null
    const finished = status === 'done' || status === 'error'
    if (finished && CHANGING.has(before)) {
      previous.delete(key)
      return 'installChanged'
    }
    if (before === 'playing' && status !== 'playing') return 'played'
    return null
  }
}
