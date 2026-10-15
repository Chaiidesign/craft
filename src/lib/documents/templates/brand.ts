// The profile a document gets when no issuer brand was supplied (D-61).
// It carries no name, no logo and a neutral palette, so nothing about the
// issuer is invented: the letterhead is left out and the issuer field stays
// missing until someone states it.

import type { BrandProfile } from '../model'

export const UNBRANDED_PROFILE_ID = 'unbranded'

export const UNBRANDED: BrandProfile = {
  profileId: UNBRANDED_PROFILE_ID,
  version: 1,
  issuerDisplayName: '',
  logo: null,
  assetStatus: 'missing',
  palette: { ink: '#1C1B19', muted: '#5E5A53', rule: '#D9D4CB', accent: '#3A3833' },
  themeId: 'placeholder',
}

export const isUnbranded = (brand: BrandProfile): boolean => brand.profileId === UNBRANDED_PROFILE_ID
