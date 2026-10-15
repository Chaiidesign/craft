// ── Baseline: today's Souvenir chat card as a token set ──────────────────────
// Hand-transcribed from the light theme (src/styles/tokens/*.css) and the
// production ArtifactCard, so the demo can show the card before and after a
// reskin. An approximation, not a source of truth:
// - Geist is loaded through next/font under a generated family name, so it
//   can't be named here; the stack falls back to the system UI face.
// - The production card draws its 1px ring with a third shadow layer; here
//   it's the border token.
// - The card has no filled action, so "primary" is the dark neutral used for
//   primary text buttons elsewhere in the app.

import type { DesignTokens } from './tokens'

export const SOUVENIR_BASELINE: DesignTokens = {
  color: {
    background: '#F9F8F5', // --neutral-white / --neutral-50
    surface: '#FFFFFF',
    text: '#3B3632', // --neutral-800
    textMuted: '#756D67', // --neutral-500
    primary: '#3B3632',
    onPrimary: '#F9F8F5',
    border: '#F5F2EF', // --neutral-100
    focus: '#3B3632',
  },
  font: {
    body: ['Geist', 'system-ui', 'sans-serif'],
    heading: ['Geist', 'system-ui', 'sans-serif'],
  },
  type: {
    caption: { font: 'body', size: 11, lineHeight: 1.45, weight: 400, letterSpacing: 0 }, // 11/16
    body: { font: 'body', size: 14, lineHeight: 1.57, weight: 400, letterSpacing: 0 }, // 14/22
    label: { font: 'body', size: 11, lineHeight: 1.45, weight: 500, letterSpacing: 0 },
    title: { font: 'heading', size: 20, lineHeight: 1.3, weight: 500, letterSpacing: 0 },
  },
  space: { xs: 2, sm: 6, md: 12, lg: 16, xl: 24 }, // card: gap 12, padding 12/16, text gap 2
  radius: { sm: 4, md: 8, lg: 12, pill: 999 }, // card radius 12
  shadow: {
    card: [
      { x: 0, y: 1, blur: 1, spread: 0, color: '#3B36320D' },
      { x: 0, y: 1.5, blur: 3, spread: 0, color: '#1A171426' },
    ],
    raised: [{ x: 0, y: 8, blur: 24, spread: 0, color: '#1A17141F' }],
  },
  size: { icon: 20, control: 36, border: 1, focusRing: 2 },
}
