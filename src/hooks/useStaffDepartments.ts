import { useEffect, useState } from 'react'
import { listApiStaffDepartments, type ApiDepartment } from '../lib/api'
import { accountSessionToken } from '../lib/store'

export function useStaffDepartments() {
  const [departments, setDepartments] = useState<ApiDepartment[]>([])

  useEffect(() => {
    let active = true
    const token = accountSessionToken()
    if (!token) {
      setDepartments([])
      return
    }

    void listApiStaffDepartments(token)
      .then(({ departments: rows }) => {
        if (active) setDepartments(rows)
      })
      .catch((error: unknown) => {
        if (active) setDepartments([])
        console.error('[staff] Could not load departments from ost_department:', error)
      })

    return () => {
      active = false
    }
  }, [])

  return departments
}
