import { useEffect, useReducer } from 'react'
import { getDb, subscribe } from '../lib/store'

export function useDb() {
  const [, forceRender] = useReducer((count: number) => count + 1, 0)
  useEffect(() => subscribe(() => forceRender()), [])
  return getDb()
}
