import { useSyncExternalStore } from 'react'
import { getDb, subscribe } from '../lib/store'

export function useDb() {
  return useSyncExternalStore(subscribe, getDb, getDb)
}
