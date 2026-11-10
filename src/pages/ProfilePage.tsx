import { FormEvent, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { listApiBranches, updateApiAccountPassword, updateApiProfile } from '../lib/api'
import { clientSessionToken, updateProfile } from '../lib/store'
import { EmptyState } from '../components/TicketThread'
import { UserAvatar, AVATAR_COLORS } from '../components/UserAvatar'
import { PasswordInput, generateSecurePassword } from '../components/PasswordInput'

import { inputClass } from "../components/ui"
export function ProfilePage() {
  const { user, updateUser } = useAuth()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [avatar, setAvatar] = useState(user?.avatar || '')
  const [branchName, setBranchName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [generated, setGenerated] = useState(false)

  function onGeneratePassword() {
    const pwd = generateSecurePassword(12)
    setNewPassword(pwd)
    setConfirmPassword(pwd)
    setGenerated(true)
    setTimeout(() => setGenerated(false), 3000)
  }

  useEffect(() => {
    if (user?.avatar !== undefined) {
      setAvatar(user.avatar || '')
    }
  }, [user?.avatar])

  useEffect(() => {
    let active = true
    void listApiBranches().then(({ branches }) => {
      if (!active || !user?.branchId || user.branchName) return
      setBranchName(branches.find((branch) => branch.id === user.branchId)?.name || 'Branch unavailable')
    }).catch(() => {
      if (active && user?.branchId && !user.branchName) setBranchName('Could not load branch name')
    })
    return () => { active = false }
  }, [user?.branchId, user?.branchName])

  if (!user || user.role !== 'client') {
    return <EmptyState title="Sign in first" body="Profiles are available for registered clients." to="/login" cta="Sign in" />
  }

  function onAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be under 2MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      setAvatar(dataUrl)
      setError('')
      setSaved(false)
      updateUser?.({ avatar: dataUrl })
      if (user) updateProfile(user.id, { avatar: dataUrl })
    }
    reader.readAsDataURL(file)
  }

  function resetAvatar() {
    setAvatar('')
    updateUser?.({ avatar: '' })
    if (user) updateProfile(user.id, { avatar: '' })
  }

  function selectAvatarColor(hex: string) {
    const colorAvatar = 'color:' + hex
    setAvatar(colorAvatar)
    setError('')
    setSaved(false)
    updateUser?.({ avatar: colorAvatar })
    if (user) updateProfile(user.id, { avatar: colorAvatar })
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const currentPassword = String(form.get('currentPassword') || '').trim()
    const newPassword = String(form.get('newPassword') || '').trim()
    const confirmPassword = String(form.get('confirmPassword') || '').trim()

    if (currentPassword || newPassword || confirmPassword) {
      if (!currentPassword) {
        setError('Please enter your current password.')
        setSaved(false)
        return
      }
      if (!newPassword || newPassword.length < 8) {
        setError('New password must be at least 8 characters long.')
        setSaved(false)
        return
      }
      if (newPassword !== confirmPassword) {
        setError('New password and confirmation password do not match.')
        setSaved(false)
        return
      }
    }

    const phone = String(form.get('phone') || '').trim().replace(/\D/g, '')
    if (phone && !/^0[79]\d{8}$/.test(phone)) {
      setError('Phone number must be in the format 0909090909 or 0707070707 (10 digits starting with 09 or 07).')
      setSaved(false)
      return
    }

    const apiSession = clientSessionToken()
    if (apiSession) {
      try {
        await updateApiProfile(apiSession, {
          name: String(form.get('name')),
          phone,
          org: String(form.get('org')),
          avatar: avatar || '',
        })
      } catch (err) {
        console.warn('[ProfilePage] API profile sync:', err)
      }
      if (newPassword) {
        try {
          await updateApiAccountPassword(apiSession, newPassword, currentPassword, 'client')
          setCurrentPassword('')
          setNewPassword('')
          setConfirmPassword('')
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not update password.')
          setSaved(false)
          return
        }
      }
    }

    const patch = {
      name: String(form.get('name')),
      phone,
      org: String(form.get('org')),
      avatar: avatar || '',
    }
    updateUser?.(patch)
    updateProfile(user!.id, patch)
    setError('')
    setSaved(true)
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold">Profile</h1>
      {saved ? (
        <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">✓</span>
            <span className="font-medium">Profile changes saved successfully.</span>
          </div>
          <button
            type="button"
            className="text-xs font-semibold text-emerald-800 underline hover:text-emerald-950"
            onClick={() => setSaved(false)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {error ? <div role="alert" className="mt-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div> : null}
      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-2xl border-4 border-slate-200 dark:border-slate-600 p-5">
        <div className="block text-sm font-medium">
          <span className="text-ink-700 dark:text-ink-300">Profile Picture & Avatar Color</span>
          <div className="mt-2 flex flex-col gap-3">
            <div className="flex items-center gap-4">
              <UserAvatar name={user.name} avatar={avatar} size="xl" />
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={onAvatarChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Change picture
                  </button>
                  {avatar ? (
                    <button
                      type="button"
                      onClick={resetAvatar}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-slate-600 dark:hover:bg-rose-950/20"
                    >
                      Reset to default
                    </button>
                  ) : null}
                </div>
                <span className="text-[11px] text-ink-400 dark:text-ink-500">Upload a custom image or pick from 12 colors below</span>
              </div>
            </div>

            <div>
              <span className="block text-xs font-semibold text-ink-700 dark:text-ink-300 mb-2">
                Choose avatar color (12 standard colors)
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {AVATAR_COLORS.map((c) => {
                  const isSelected =
                    avatar === `color:${c.hex}` ||
                    avatar === c.hex ||
                    (!avatar && c.id === 'emerald')
                  return (
                    <button
                      key={c.id}
                      type="button"
                      title={c.name}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        selectAvatarColor(c.hex)
                      }}
                      style={{ backgroundColor: c.hex }}
                      className={`h-7 w-7 rounded-full shadow-sm transition-transform hover:scale-110 flex items-center justify-center text-white text-xs font-bold ring-2 ${
                        isSelected ? 'ring-offset-2 ring-brand-600 dark:ring-white scale-110' : 'ring-transparent'
                      }`}
                    >
                      {isSelected ? '✓' : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
        <label className="block text-sm font-medium">
          Name
          <input name="name" defaultValue={user.name} className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Email
          <input disabled value={user.email} className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Employee ID
          <input disabled value={user.employeeId || 'Not set'} className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Branch
          <input disabled value={user.branchName || (user.branchId ? branchName || 'Loading branch name…' : 'Not set')} className={inputClass + " mt-1"} />
        </label>
        <label className="block text-sm font-medium">
          Phone
          <input
            name="phone"
            defaultValue={user.phone}
            inputMode="numeric"
            maxLength={10}
            placeholder="Please enter your phone number"
            className={inputClass + " mt-1"}
            onInput={(e) => {
              const el = e.currentTarget
              el.value = el.value.replace(/\D/g, '').slice(0, 10)
            }}
          />
        </label>
        <label className="block text-sm font-medium">
          Organization
          <input name="org" defaultValue={user.org} className={inputClass + " mt-1"} />
        </label>
        <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
          <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-200 mb-1">Change Password</h3>
          <p className="text-xs text-ink-500 dark:text-ink-400 mb-3">
            Write your current password first, then enter or generate a new password and confirm it.
          </p>

          <div className="space-y-3">
            <label className="block text-sm font-medium">
              Current password
              <PasswordInput
                name="currentPassword"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Type your current password"
                className="mt-1"
                autoComplete="off"
                readOnly
                onFocus={(e) => {
                  e.currentTarget.readOnly = false
                }}
                data-lpignore="true"
                data-1p-ignore="true"
              />
            </label>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="block text-sm font-medium">New password</span>
                <div className="flex items-center gap-2">
                  {generated ? (
                    <span className="text-xs font-semibold text-emerald-600">✓ Generated & filled</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={onGeneratePassword}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:text-brand-300 shadow-sm transition hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    <span>⚡</span> Generate Password
                  </button>
                </div>
              </div>
              <PasswordInput
                name="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                placeholder="Enter or generate new password"
                autoComplete="new-password"
              />
            </div>

            <label className="block text-sm font-medium">
              Confirm new password
              <PasswordInput
                name="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter the new password"
                className="mt-1"
                autoComplete="new-password"
              />
            </label>
          </div>
        </div>
        <button type="submit" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
          Save
        </button>
      </form>
    </div>
  )
}
