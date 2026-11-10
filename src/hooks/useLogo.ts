import { useEffect, useState } from 'react'
import { companyAssetUrl, getApiPublicBranding } from '../lib/api'
import { useDb } from './useDb'
import { saveSettings } from '../lib/store'

/**
 * Returns the URL (data URL or server asset URL) for a company logo or login backdrop,
 * or `null` when not selected or not yet loaded.
 *
 * 1. Checks `db.settings.clientLogo` / `staffLogo` / `staffBackdrop` directly (data URL or asset URL).
 * 2. If not found, checks `db.settings.clientLogoId` / `staffLogoId` / `staffBackdropId` -> `companyAssetUrl(id)`.
 * 3. If neither found, asynchronously fetches `/api/v1/company/branding` from backend, updates state, and saves to store.
 */
export function useLogo(kind: 'client' | 'staff' | 'backdrop'): string | null {
  const db = useDb()
  const [remoteId, setRemoteId] = useState<string | null>(null)

  // Direct string URL / data URL in settings
  const directValue =
    kind === 'client'
      ? db.settings.clientLogo
      : kind === 'staff'
        ? db.settings.staffLogo
        : db.settings.staffBackdrop

  // Asset ID in settings
  const id =
    kind === 'client'
      ? db.settings.clientLogoId
      : kind === 'staff'
        ? db.settings.staffLogoId
        : db.settings.staffBackdropId

  useEffect(() => {
    let active = true
    if (!directValue && (!id || id === '0')) {
      void getApiPublicBranding()
        .then((branding) => {
          if (!active || !branding) return
          const fetchedId =
            kind === 'client'
              ? branding.clientLogoId
              : kind === 'staff'
                ? branding.staffLogoId
                : branding.staffBackdropId
          if (fetchedId && fetchedId !== '0') {
            setRemoteId(fetchedId)
            saveSettings({
              [kind === 'client' ? 'clientLogoId' : kind === 'staff' ? 'staffLogoId' : 'staffBackdropId']: fetchedId,
            })
          }
        })
        .catch(() => {})
    }
    return () => {
      active = false
    }
  }, [directValue, id, kind])

  if (directValue && directValue.trim()) {
    return directValue.trim()
  }

  const effectiveId = id && id !== '0' ? id : remoteId
  if (!effectiveId || effectiveId === '0') return null
  return companyAssetUrl(effectiveId)
}
