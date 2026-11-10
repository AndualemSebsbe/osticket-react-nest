import { useSyncExternalStore } from 'react'
import { getDb, getRevision, subscribe } from '../lib/store'

export function useDb() {
  // The store mutates its cached database object in place, so getDb() keeps
  // returning the same reference after each change and useSyncExternalStore
  // cannot detect the update by comparing snapshots. Subscribe to the store's
  // revision counter instead: every save bumps it, which forces React to
  // re-render and re-read the latest database object.
  useSyncExternalStore(subscribe, getRevision, getRevision)
  return getDb()
}
