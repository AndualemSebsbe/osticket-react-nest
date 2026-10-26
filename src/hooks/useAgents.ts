import { useEffect, useState } from 'react'
import { listApiAssignableStaff, type ApiAssignableStaff } from '../lib/api'
import { accountSessionToken } from '../lib/store'

export function useAgents() {
  const [agents, setAgents] = useState<ApiAssignableStaff[]>([])

  useEffect(() => {
    let active = true
    const token = accountSessionToken()
    if (!token) {
      setAgents([])
      return
    }

    void listApiAssignableStaff(token)
      .then(({ staff }) => {
        if (active) setAgents(staff.filter((person) => person.role === 'agent' && person.active))
      })
      .catch((error: unknown) => {
        if (active) setAgents([])
        console.error('[staff] Could not load agents from ost_staff:', error)
      })

    return () => {
      active = false
    }
  }, [])

  return agents
}
