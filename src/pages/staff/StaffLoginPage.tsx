import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useLogo } from '../../hooks/useLogo'
import { useDb } from '../../hooks/useDb'
import { hydratePublicBrandingFromApi } from '../../lib/store'

function maskIdentifier(value: string) {
  const at = value.indexOf('@')
  if (at > 0) return value[0] + '***' + value.slice(at)
  return value.length > 2 ? value[0] + '***' + value.slice(-1) : '***'
}

function DefaultAgentBadge() {
  return (
    <div className="flex flex-col items-start">
      <div className="relative flex items-center justify-center w-14 h-14">
        {/* Glow halo */}
        <div className="absolute inset-0 rounded-full bg-blue-400/30 blur-md" />
        <svg
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative w-12 h-12 text-white drop-shadow"
        >
          {/* Radiant rays above */}
          <path d="M32 6V11" stroke="#FDE047" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M22 9L25 13.5" stroke="#FDE047" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M42 9L39 13.5" stroke="#FDE047" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M14 16L18.5 19.5" stroke="#FDE047" strokeWidth="2" strokeLinecap="round" />
          <path d="M50 16L45.5 19.5" stroke="#FDE047" strokeWidth="2" strokeLinecap="round" />

          {/* Central Shield */}
          <path
            d="M32 15C32 15 41 17 44 23C44 33 36 39 32 41C28 39 20 33 20 23C23 17 32 15 32 15Z"
            fill="#3B82F6"
            stroke="#FFFFFF"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {/* Inner crest / lock / support symbol */}
          <path
            d="M28 25C28 22.8 29.8 21 32 21C34.2 21 36 22.8 36 25V27H28V25Z"
            stroke="#FFFFFF"
            strokeWidth="1.75"
            fill="none"
          />
          <rect x="26.5" y="27" width="11" height="8" rx="2" fill="#FFFFFF" />

          {/* Supporting hands underneath */}
          <path
            d="M13 36C15 34 19 33 23 37L28 42C26 44 21 44 17 41L13 36Z"
            fill="#FFFFFF"
            fillOpacity="0.95"
          />
          <path
            d="M51 36C49 34 45 33 41 37L36 42C38 44 43 44 47 41L51 36Z"
            fill="#FFFFFF"
            fillOpacity="0.95"
          />
          <path
            d="M18 43C22 47 28 49 32 49C36 49 42 47 46 43"
            stroke="#93C5FD"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  )
}

export function StaffLoginPage() {
  const { login, user, ready } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const staffLogoUrl = useLogo('staff')
  const backdropUrl = useLogo('backdrop')
  const db = useDb()

  // Interactive mouse parallax state
  const containerRef = useRef<HTMLDivElement>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0, percentX: 50, percentY: 50 })

  useEffect(() => {
    // Ensure branding is loaded fresh on login mount
    void hydratePublicBrandingFromApi()
  }, [])

  useEffect(() => {
    if (!ready || !user || (user.role !== 'agent' && user.role !== 'admin')) return
    navigate(user.role === 'admin' ? '/scp/admin' : '/scp', { replace: true })
  }, [navigate, ready, user])

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = rect.width
    const height = rect.height
    const clientX = e.clientX - rect.left
    const clientY = e.clientY - rect.top

    // Normalized from -1 to 1
    const x = ((clientX / width) - 0.5) * 2
    const y = ((clientY / height) - 0.5) * 2

    // Percentage coordinates (0% to 100%) for spotlight
    const percentX = (clientX / width) * 100
    const percentY = (clientY / height) * 100

    setMouse({ x, y, percentX, percentY })
  }

  function handleMouseLeave() {
    setMouse({ x: 0, y: 0, percentX: 50, percentY: 50 })
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const identifier = String(form.get('email') || '').trim()
    const password = String(form.get('password') || '')
    console.info('[staff-login/ui] submit', { identifier: maskIdentifier(identifier), passwordProvided: Boolean(password) })
    setSubmitting(true)
    setError('')
    try {
      const result = await login(identifier, password)
      if (!result.user) {
        const message = result.error || 'Staff sign-in failed. Please check your credentials.'
        console.error('[staff-login/ui] sign-in returned an error', message)
        setError(message)
        return
      }
      console.info('[staff-login/ui] sign-in complete', { userId: result.user.id, role: result.user.role })
      navigate(result.user.role === 'admin' ? '/scp/admin' : '/scp', { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Staff sign-in failed.'
      console.error('[staff-login/ui] submit handler threw', err)
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative flex min-h-dvh items-center justify-center p-4 sm:p-6 md:p-10 overflow-hidden bg-slate-100 dark:bg-[#070b14] select-none"
    >
      {/* =========================================================================
          INTERACTIVE BACKDROP SYSTEM
          Prominently displays any uploaded backdrop with interactive parallax & lighting
          ========================================================================= */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        
        {/* Layer 0: Ambient Base Gradient */}
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-200 via-slate-100 to-slate-200 dark:from-[#050811] dark:via-[#091122] dark:to-[#050811]" />

        {backdropUrl ? (
          <>
            {/* Layer 1: Ambient Color Aura (Diffused Glow behind the main image) */}
            <div
              className="absolute -inset-16 transition-transform duration-700 ease-out bg-cover bg-center opacity-40 dark:opacity-30 blur-2xl saturate-150"
              style={{
                backgroundImage: `url(${backdropUrl})`,
                transform: `translate3d(${mouse.x * 20}px, ${mouse.y * 20}px, 0) scale(1.15)`,
              }}
            />

            {/* Layer 2: Main Backdrop Image with Smooth 3D Interactive Parallax (Full Bleed Cover) */}
            <div
              className="absolute -inset-10 transition-transform duration-500 ease-out bg-cover bg-center"
              style={{
                backgroundImage: `url(${backdropUrl})`,
                transform: `translate3d(${mouse.x * -30}px, ${mouse.y * -30}px, 0) scale(1.08)`,
              }}
            />

            {/* Layer 3: Contrast Protection Overlay (Keeps text crystal clear while leaving image bold) */}
            <div className="absolute inset-0 bg-slate-900/10 dark:bg-black/35 backdrop-blur-[1px]" />

            {/* Layer 4: Interactive Mouse Spotlight / Luminous Sheen across the image */}
            <div
              className="absolute inset-0 transition-opacity duration-300"
              style={{
                background: `radial-gradient(circle 650px at ${mouse.percentX}% ${mouse.percentY}%, rgba(255, 255, 255, 0.22), transparent 70%)`,
                mixBlendMode: 'overlay',
              }}
            />
          </>
        ) : (
          /* Default dynamic ambient glow spheres when no custom backdrop is chosen */
          <div
            className="absolute inset-0 flex items-center justify-center transition-transform duration-700 ease-out"
            style={{
              transform: `translate3d(${mouse.x * -35}px, ${mouse.y * -35}px, 0)`,
            }}
          >
            <div className="w-[32rem] h-[32rem] rounded-full bg-blue-500/15 dark:bg-blue-600/20 blur-3xl animate-pulse" />
            <div className="absolute -top-10 -right-10 w-96 h-96 rounded-full bg-indigo-500/15 dark:bg-indigo-600/15 blur-3xl" />
          </div>
        )}

        {/* Layer 5: Subtle Micro Tech Grid Texture */}
        <div
          className="absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
          style={{
            backgroundImage: `radial-gradient(currentColor 1.5px, transparent 1.5px)`,
            backgroundSize: '28px 28px',
          }}
        />
      </div>

      {/* =========================================================================
          MAIN LOGIN SPLIT-CARD WITH COMPLEMENTARY 3D TILT
          ========================================================================= */}
      <div
        className="relative z-10 w-full max-w-4xl overflow-hidden rounded-3xl bg-white/95 dark:bg-[#0c1220]/95 backdrop-blur-xl shadow-[0_25px_70px_-15px_rgba(0,0,0,0.35)] dark:shadow-[0_30px_90px_-20px_rgba(0,0,0,0.75)] border border-slate-200/90 dark:border-slate-800/90 grid md:grid-cols-[1.05fr_1.15fr] transition-transform duration-300 ease-out"
        style={{
          transform: `perspective(1000px) rotateX(${mouse.y * -1.8}deg) rotateY(${mouse.x * 1.8}deg) translateZ(8px)`,
        }}
      >
        {/* Left Side: Brand Panel */}
        <div className="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-[#004ce6] via-[#0057ff] to-[#0038b3] dark:from-[#002f8c] dark:via-[#003db3] dark:to-[#001f5c] p-8 sm:p-10 text-white min-h-[22rem] md:min-h-[32rem]">
          
          {/* Subtle curved wave background patterns */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <svg
              className="absolute -bottom-6 left-0 right-0 w-[140%] -ml-[20%] h-64 opacity-35"
              viewBox="0 0 500 250"
              fill="none"
              preserveAspectRatio="none"
            >
              <path
                d="M0 160 C150 80 300 220 500 130 L500 250 L0 250 Z"
                fill="url(#wave1)"
              />
              <path
                d="M0 190 C140 130 320 230 500 170 L500 250 L0 250 Z"
                fill="url(#wave2)"
                opacity="0.75"
              />
              <defs>
                <linearGradient id="wave1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#60A5FA" />
                  <stop offset="100%" stopColor="#1E40AF" />
                </linearGradient>
                <linearGradient id="wave2" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#93C5FD" />
                  <stop offset="100%" stopColor="#1D4ED8" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Top Brand & Logo */}
          <div className="relative z-10">
            {staffLogoUrl ? (
              <img
                src={staffLogoUrl}
                alt={db.settings.helpdeskName || 'osTicket'}
                className="h-14 w-auto max-w-[13rem] object-contain drop-shadow-md"
              />
            ) : (
              <DefaultAgentBadge />
            )}

            <p className="mt-8 text-[11px] font-bold uppercase tracking-[0.25em] text-blue-200">
              Staff Control Panel
            </p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Agent Panel
            </h2>
            <p className="mt-4 text-sm text-blue-100/90 leading-relaxed max-w-xs">
              Manage tickets, assist users, and stay productive.
            </p>
          </div>

          {/* Bottom subtle copyright / system info */}
          <div className="relative z-10 pt-6">
            <span className="text-xs text-blue-200/70 font-medium">
              {db.settings.helpdeskName || 'osTicket'} Support System
            </span>
          </div>
        </div>

        {/* Right Side: Sign In Form */}
        <div className="relative flex flex-col justify-center p-8 sm:p-12 bg-white/95 dark:bg-[#0c1220]/95 backdrop-blur-sm">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              Welcome back
            </h1>

            <form onSubmit={onSubmit} className="mt-7 space-y-5">
              {error ? (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 px-3.5 py-2.5 text-sm text-rose-700 dark:text-rose-300">
                  {error}
                </div>
              ) : null}

              {/* Email / Username field */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Email or username <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  name="email"
                  type="text"
                  autoComplete="username"
                  placeholder="zekisebisib@gmail.com"
                  className="w-full rounded-xl bg-blue-50/60 dark:bg-slate-800/80 border border-blue-100/80 dark:border-slate-700 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition shadow-inner"
                />
              </div>

              {/* Password field with toggle view */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    required
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••••••"
                    className="w-full rounded-xl bg-blue-50/60 dark:bg-slate-800/80 border border-blue-100/80 dark:border-slate-700 px-4 py-3 pr-11 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition shadow-inner"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-semibold py-3 text-sm shadow-md shadow-blue-500/25 transition disabled:opacity-60 cursor-pointer"
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            {/* Divider */}
            <div className="relative flex items-center justify-center my-6">
              <div className="w-full border-t border-slate-200 dark:border-slate-800" />
              <span className="absolute bg-white dark:bg-[#0c1220] px-3 text-xs text-slate-400">
                or
              </span>
            </div>

            {/* Links */}
            <div className="text-center text-xs sm:text-sm font-medium">
              <Link
                to="/scp/login/pwreset"
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition"
              >
                Forgot password?
              </Link>
              <span className="text-slate-300 dark:text-slate-700 mx-2">·</span>
              <Link
                to="/"
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition"
              >
                Client portal
              </Link>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
