// Fictional issuer brand profiles. No real organisations; no Souvenir branding.
//
// `themeId` names a typography theme resolved by `theme.ts` (Step 2). Brand
// profiles never name a font family.

import type { BrandProfile } from '../model'

const RESTRAINED = { ink: '#1C1B19', muted: '#5E5A53', rule: '#D9D4CB' }

export const HALDEN_ROWE: BrandProfile = {
  profileId: 'brand-halden-rowe',
  version: 1,
  issuerDisplayName: 'Halden & Rowe Studio',
  logo: {
    assetId: 'asset-halden-rowe-mark',
    src: '/document-fixtures/halden-rowe-mark.png',
    alt: 'Halden & Rowe Studio mark (fictional)',
    widthPx: 240,
    heightPx: 240,
  },
  assetStatus: 'supplied',
  palette: { ...RESTRAINED, accent: '#2F5D50' },
  themeId: 'placeholder',
}

export const MARROW_FINCH: BrandProfile = {
  profileId: 'brand-marrow-finch',
  version: 1,
  issuerDisplayName: 'Marrow & Finch Joinery',
  logo: null,
  assetStatus: 'missing',
  palette: { ...RESTRAINED, accent: '#7A4B2A' },
  themeId: 'placeholder',
}

export const SAFFRON_LOOM: BrandProfile = {
  profileId: 'brand-saffron-loom',
  version: 1,
  issuerDisplayName: 'Saffron Loom Textiles Pvt. Ltd.',
  logo: null,
  assetStatus: 'missing',
  palette: { ...RESTRAINED, accent: '#9A5B13' },
  themeId: 'placeholder',
}

export const BRIGHTWATER: BrandProfile = {
  profileId: 'brand-brightwater',
  version: 1,
  issuerDisplayName: 'Brightwater Research Studio',
  logo: null,
  assetStatus: 'missing',
  palette: { ...RESTRAINED, accent: '#2B4C7E' },
  themeId: 'placeholder',
}

// Fixture 10: brand fallback cases.

export const PELL_DARROW_NO_LOGO: BrandProfile = {
  profileId: 'brand-pell-darrow',
  version: 1,
  issuerDisplayName: 'Pell & Darrow Bookbinders',
  logo: null,
  assetStatus: 'missing',
  palette: { ...RESTRAINED, accent: '#5B3A6B' },
  themeId: 'placeholder',
}

/** Claims a supplied logo whose file does not exist — the renderer must detect it and fall back. */
export const QUILLON_BROKEN_LOGO: BrandProfile = {
  profileId: 'brand-quillon',
  version: 1,
  issuerDisplayName: 'Quillon Survey Partners',
  logo: {
    assetId: 'asset-quillon-mark',
    src: '/document-fixtures/quillon-mark-missing-file.png',
    alt: 'Quillon Survey Partners mark (fictional)',
    widthPx: 320,
    heightPx: 120,
  },
  assetStatus: 'supplied',
  palette: { ...RESTRAINED, accent: '#3E6A2F' },
  themeId: 'placeholder',
}

export const NORTHERN_COOPERATIVE_LONG_NAME: BrandProfile = {
  profileId: 'brand-northern-coop',
  version: 1,
  issuerDisplayName: 'The Northern Cooperative for Sustainable Textile Manufacturing and Fair-Trade Distribution Ltd.',
  logo: null,
  assetStatus: 'missing',
  palette: { ...RESTRAINED, accent: '#245A6B' },
  themeId: 'placeholder',
}
