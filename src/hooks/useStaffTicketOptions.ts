import { useEffect, useState } from 'react'
import { getApiStaffTicketOptions, type ApiStaffTicketOptions } from '../lib/api'
import { accountSessionToken } from '../lib/store'

const emptyOptions: ApiStaffTicketOptions = { statuses: [], topics: [], priorities: [] }

export function useStaffTicketOptions() {
  const [options, setOptions] = useState<ApiStaffTicketOptions>(emptyOptions)

  useEffect(() => {
    let active = true
    const token = accountSessionToken()
    if (!token) {
      setOptions(emptyOptions)
      return
    }

    void getApiStaffTicketOptions(token)
      .then((result) => { if (active) setOptions(result) })
      .catch((error: unknown) => {
        if (active) setOptions(emptyOptions)
        console.error('[staff] Could not load ticket options from PostgreSQL:', error)
      })

    return () => { active = false }
  }, [])

  return options
}
