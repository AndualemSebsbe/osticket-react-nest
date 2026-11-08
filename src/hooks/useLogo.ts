import { companyAssetUrl } from '../lib/api'
import { useDb } from './useDb'

/**
 * Returns the URL for a company logo stored in the backend, or `null` when
 * the admin has not selected a logo for the given context.
 *
 * @param kind - 'client' for the client portal logo, 'staff' for the staff
 *               control panel logo, 'backdrop' for the staff login backdrop.
 */
export function useLogo(kind: 'client' | 'staff' | 'backdrop'): string | null {
  const db = useDb()
  const id =
    kind === 'client'
      ? db.settings.clientLogoId
      : kind === 'staff'
        ? db.settings.staffLogoId
        : db.settings.staffBackdropId
  if (!id || id === '0') return null
  return companyAssetUrl(id)
}
