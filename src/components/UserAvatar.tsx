import { type ImgHTMLAttributes } from 'react'

export interface AvatarColorOption {
  id: string
  name: string
  hex: string
  className: string
}

export const AVATAR_COLORS: readonly AvatarColorOption[] = [
  { id: 'emerald', name: 'Emerald Green', hex: '#059669', className: 'bg-emerald-600 text-white' },
  { id: 'blue', name: 'Sapphire Blue', hex: '#2563eb', className: 'bg-blue-600 text-white' },
  { id: 'indigo', name: 'Deep Indigo', hex: '#4f46e5', className: 'bg-indigo-600 text-white' },
  { id: 'purple', name: 'Royal Purple', hex: '#9333ea', className: 'bg-purple-600 text-white' },
  { id: 'violet', name: 'Electric Violet', hex: '#7c3aed', className: 'bg-violet-600 text-white' },
  { id: 'pink', name: 'Berry Pink', hex: '#db2777', className: 'bg-pink-600 text-white' },
  { id: 'rose', name: 'Crimson Rose', hex: '#e11d48', className: 'bg-rose-600 text-white' },
  { id: 'red', name: 'Ruby Red', hex: '#dc2626', className: 'bg-red-600 text-white' },
  { id: 'orange', name: 'Sunset Orange', hex: '#ea580c', className: 'bg-orange-600 text-white' },
  { id: 'amber', name: 'Warm Amber', hex: '#d97706', className: 'bg-amber-600 text-white' },
  { id: 'teal', name: 'Ocean Teal', hex: '#0d9488', className: 'bg-teal-600 text-white' },
  { id: 'cyan', name: 'Sky Cyan', hex: '#0891b2', className: 'bg-cyan-600 text-white' },
] as const

export const DEFAULT_AVATAR_COLOR = AVATAR_COLORS[0]

interface UserAvatarProps extends ImgHTMLAttributes<HTMLImageElement> {
  name?: string
  avatar?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-20 w-20 text-xl font-bold',
}

export function getInitials(name?: string) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Returns the default green avatar color for clients and admins
export function getAvatarColor(_name?: string): AvatarColorOption {
  return DEFAULT_AVATAR_COLOR
}

export function UserAvatar({ name, avatar, size = 'md', className = '', ...imgProps }: UserAvatarProps) {
  const sizeClass = sizeClasses[size] || sizeClasses.md

  // 1. Color avatar (e.g. "color:#2563eb" or "color:blue" or hex "#...")
  if (avatar && (avatar.startsWith('color:') || avatar.startsWith('#'))) {
    const colorKey = avatar.startsWith('color:') ? avatar.slice(6) : avatar
    const matched = AVATAR_COLORS.find(
      (c) => c.id === colorKey || c.hex.toLowerCase() === colorKey.toLowerCase()
    )
    const colorClass = matched ? matched.className : ''
    const customStyle = !matched && colorKey.startsWith('#') ? { backgroundColor: colorKey, color: '#ffffff' } : undefined

    return (
      <span
        style={customStyle}
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none shadow-sm ring-2 ring-white/20 ${sizeClass} ${colorClass} ${className}`}
        aria-label={name ? `${name}'s avatar` : 'User avatar'}
      >
        {getInitials(name)}
      </span>
    )
  }

  // 2. Image avatar URL
  if (avatar && avatar.trim()) {
    return (
      <img
        src={avatar}
        alt={name ? `${name}'s profile picture` : 'Profile picture'}
        className={`inline-block rounded-full object-cover ring-2 ring-brand-500/20 shadow-sm ${sizeClass} ${className}`}
        onError={(e) => {
          // If image fails to load, replace with initials
          e.currentTarget.style.display = 'none'
          const fallback = e.currentTarget.nextElementSibling as HTMLElement
          if (fallback) fallback.style.display = 'inline-flex'
        }}
        {...imgProps}
      />
    )
  }

  // 3. Fallback initials with automatic color from name
  const fallbackColor = getAvatarColor(name)
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none shadow-sm ring-2 ring-white/20 ${sizeClass} ${fallbackColor.className} ${className}`}
      aria-label={name ? `${name}'s avatar` : 'User avatar'}
    >
      {getInitials(name)}
    </span>
  )
}
