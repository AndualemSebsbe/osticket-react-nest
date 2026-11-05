import { useEffect, useState } from 'react'
import { companyAssetUrl, getApiPublicBranding } from '../lib/api'
import { useDb } from './useDb'
import { saveSettings } from '../lib/store'

/**
 * Returns the URL for a company logo or login backdrop stored in the backend,
 * or `null` when not selected or not yet loaded.
 *
 * Automatically fetches public branding from the server if not already in store.
 *
 * @param kind - 'client' for the client portal logo, 'staff' for the staff
 *               control panel logo, 'backdrop' for the staff login backdrop.
 */
export function useLogo(kind: 'client' | 'staff' | 'backdrop'): string | null {
  const db = useDb()
  const [remoteId, setRemoteId] = useState<string | null>(null)

  const id =
    kind === 'client'
      ? db.settings.clientLogoId
      : kind === 'staff'
        ? db.settings.staffLogoId
        : db.settings.staffBackdropId

  useEffect(() => {
    let active = true
    if (!id || id === '0') {
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
  }, [id, kind])

  const effectiveId = id && id !== '0' ? id : remoteId
  if (!effectiveId || effectiveId === '0') return null
  return companyAssetUrl(effectiveId)
}
