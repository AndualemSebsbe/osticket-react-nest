import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiRequestError, apiClientLogin, apiStaffLogin, apiValidateClientSession, apiValidateStaffSession } from '../lib/api'
import { accountSessionToken, currentUser, establishApiSession, hydrateAppStateFromApi, hydrateAssignableStaffFromApi, hydrateTicketsFromApi, logout as doLogout, register as doRegister, subscribe } from '../lib/store'
import type { User } from '../types'

interface AuthValue {
  user: User | null
  ready: boolean
  login: (email: string, password: string) => Promise<{ user?: User; error?: string }>
  loginClient: (email: string, password: string) => Promise<{ user?: User; error?: string }>
  register: (input: { name: string; email: string; password: string; phone?: string }) => Promise<User>
  logout: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const authRevision = useRef(0)

  useEffect(() => {
    let alive = true
    const validate = async () => {
      const revision = authRevision.current
      const saved = currentUser()
      const token = accountSessionToken()
      if (saved && !token) {
        doLogout()
        if (alive) setUser(null)
        if (alive) setReady(true)
        return
      }
      if (!saved || !token) {
        if (token && !saved) doLogout()
        if (alive) setUser(null)
        if (alive) setReady(true)
        return
      }
      console.info('[auth-session] validating stored session', { role: saved.role, tokenPresent: true })
      try {
        const isStaff = saved.role === 'agent' || saved.role === 'admin'
        const result = isStaff
          ? await apiValidateStaffSession(token)
          : await apiValidateClientSession(token)
        if (revision !== authRevision.current) return
        if (saved.role !== result.role) {
          console.warn('[auth-session] session role mismatch; clearing session', { savedRole: saved.role, serverRole: result.role })
          doLogout()
          if (alive) setUser(null)
          return
        }
        console.info('[auth-session] session accepted', { role: result.role, userId: result.user.id })
        try {
          if (result.role === 'agent' || result.role === 'admin') await hydrateAssignableStaffFromApi(token)
          await hydrateTicketsFromApi(token)
          await hydrateAppStateFromApi(token, result.role)
        } catch (error) {
          // A failed data refresh does not mean the signed-in account is invalid.
          console.warn('[helpdesk session refresh]', error instanceof Error ? error.message : error)
        }
        if (alive && revision === authRevision.current) setUser(currentUser() || saved)
      } catch (error) {
        // Only clear credentials when the API explicitly rejects the session.
        // Network errors and server errors should not sign the user out.
        if (revision !== authRevision.current) return
        if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
          console.warn('[auth-session] API rejected the session; clearing it', { status: error.status, message: error.message })
          doLogout()
          if (alive) setUser(null)
        } else {
          console.error('[auth-session] validation request failed without an auth rejection; keeping session', error)
          if (alive) setUser(currentUser() || saved)
        }
      } finally {
        if (alive && revision === authRevision.current) setReady(true)
      }
    }
    void validate()
    const unsubscribe = subscribe(() => setUser(currentUser()))
    const timer = window.setInterval(() => { void validate() }, 60_000)
    return () => { alive = false; unsubscribe(); window.clearInterval(timer) }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      ready,
      login: async (email, password) => {
        console.info('[staff-login] starting API sign-in', { identifierProvided: Boolean(email.trim()), passwordProvided: Boolean(password) })
        try {
          const result = await apiStaffLogin(email, password)
          console.info('[staff-login] API accepted credentials', { userId: result.user.id, role: result.user.role, sessionTokenReceived: Boolean(result.sessionToken) })
          authRevision.current += 1
          const next = establishApiSession(result.user, result.sessionToken)
          setReady(true)
          console.info('[staff-login] browser session stored', { userId: next.id, role: next.role, sessionStored: Boolean(accountSessionToken()) })
          setUser(next)
          void (async () => {
            try {
              await hydrateAssignableStaffFromApi(result.sessionToken)
              console.info('[staff-login] staff directory loaded')
              await hydrateTicketsFromApi(result.sessionToken)
              console.info('[staff-login] ticket data loaded')
              await hydrateAppStateFromApi(result.sessionToken, result.user.role)
              console.info('[staff-login] shared application data loaded from PostgreSQL')
            } catch (error) {
              console.error('[staff-login] post-login data loading failed; keeping the session', error)
            }
          })()
          return { user: next }
        } catch (error) {
          console.error('[staff-login] sign-in failed', error)
          return { error: error instanceof Error ? error.message : 'Staff sign-in failed.' }
        }
      },
      loginClient: async (email, password) => {
        try {
          const result = await apiClientLogin(email, password)
          if (result.found) {
            if (result.status === 'pending') return { error: 'Your account is waiting for administrator verification.' }
            if (result.status === 'rejected') return { error: 'Your account was not approved. Contact the help desk administrator.' }
            if (result.status === 'disabled') return { error: 'This client account is disabled. Contact the help desk administrator.' }
            if (result.status !== 'approved' || !result.user || !result.sessionToken) return { error: 'The account service could not verify this account.' }
            const next = establishApiSession({ ...result.user, role: 'client' }, result.sessionToken)
            setUser(next)
            try {
              await hydrateTicketsFromApi(result.sessionToken)
              await hydrateAppStateFromApi(result.sessionToken, 'client')
            } catch (error) {
              console.warn('[helpdesk initial ticket refresh]', error instanceof Error ? error.message : error)
            }
            return { user: next }
          }
          return { error: 'Sign-in failed. Check your email and password.' }
        } catch (error) {
          if (error instanceof Error && error.message === 'Invalid email or password.') return { error: error.message }
          return { error: error instanceof Error ? error.message : 'The account service is unavailable; sign-in is blocked.' }
        }
      },
      register: async (input) => {
        const next = await doRegister(input)
        setUser(currentUser())
        return next
      },
      logout: () => {
        doLogout()
        setUser(null)
      },
    }),
    [user, ready],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
