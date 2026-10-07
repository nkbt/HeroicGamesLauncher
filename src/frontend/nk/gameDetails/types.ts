// nk: #5 - types of the renderer game details cache.
//
// Cache policy: entries never expire and carry no timestamps. A slot is
// either filled or missing. A filled slot is served as-is (no IPC) until
// that game's Refresh button or a real local event for that game (install,
// uninstall, update, repair or move finished; play session ended; settings
// edited) replaces it.
import type { GameInfo } from 'common/types'

/** `${runner}:${appName}` for game slots, `settings:${appName}` for config */
export type DetailsKey = string

/**
 * Extra info is cached per UI language (`extraInfo@en`), install info per
 * install platform (`installInfo@Windows`).
 */
export type SlotId =
  | 'wikiInfo'
  | 'achievements'
  | 'settings'
  | 'anticheat'
  | 'knownFixes'
  | 'launchOptions'
  | `extraInfo@${string}`
  | `installInfo@${string}`

export interface Slot<T = unknown> {
  /** `null` is a cached "none" (distinct from a missing slot) */
  data: T | null
  accountId?: string
}

/** Which library list fields a group of slots was fetched against. */
export type ListGroup = 'meta' | 'install' | 'art'
export type ListSig = Partial<Record<ListGroup, string>>

export interface GameDetailsEntry {
  slots: Partial<Record<SlotId, Slot>>
  gameInfo?: GameInfo
  /** signatures of the library list data the slots were fetched with */
  listSig?: ListSig
  observedListSig?: ListSig
  pendingListSig?: ListSig
  installEventBaseline?: string
  /** consecutive all-empty wiki results (3 store the "none" marker) */
  wikiEmpty?: number
  pendingInstall?: boolean
  pendingPlay?: boolean
}

export type Entries = Record<DetailsKey, GameDetailsEntry>

export const detailsKey = (runner: string, appName: string) =>
  `${runner}:${appName}`

export const settingsKey = (appName: string) => `settings:${appName}`

export const extraInfoSlot = (language: string): SlotId =>
  `extraInfo@${language}`

export const installInfoSlot = (installPlatform: string): SlotId =>
  `installInfo@${installPlatform}`

export const isExtraInfoSlot = (slot: string) => slot.startsWith('extraInfo@')

export const isInstallInfoSlot = (slot: string) =>
  slot.startsWith('installInfo@')

/** The list group a slot depends on (none for local-only slots). */
export function listGroupOf(slot: SlotId): ListGroup | null {
  if (isExtraInfoSlot(slot)) return 'meta'
  if (isInstallInfoSlot(slot)) return 'install'
  switch (slot) {
    case 'wikiInfo':
    case 'anticheat':
      return 'meta'
    case 'launchOptions':
      return 'install'
    default:
      return null
  }
}
