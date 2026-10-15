// ── Offline mock extractor ────────────────────────────────────────────────────
// Stands in for a vision model so the whole pipeline runs and tests offline.
// It recognizes the three committed sample images by SHA-256 and returns the
// reading a careful extractor would give for each, including the tokens it
// couldn't read. Any other image is reported as unrecognized: the mock never
// invents a reading.

import { UnrecognizedImageError, type DesignImage, type TokenExtractor } from './extractor'
import type { Confidence, ProposedToken } from './proposal'
import type { TokenPath } from './tokens'

export interface SampleImage {
  id: string
  name: string
  /** Public path of the committed file. */
  src: string
  /** SHA-256 of the file's bytes, hex. */
  sha256: string
  /** Where the file lives in the repo, for tests. */
  file: string
}

export const SAMPLE_IMAGES: readonly SampleImage[] = [
  {
    id: 'ledger',
    name: 'Ledger — warm editorial',
    src: '/design-system-samples/ledger.svg',
    sha256: '2547c34ea712880897c3d830c3b360a67704a0629765aaff75ab376031509827',
    file: 'public/design-system-samples/ledger.svg',
  },
  {
    id: 'night-console',
    name: 'Night Console — dark and flat',
    src: '/design-system-samples/night-console.svg',
    sha256: '56ce5eea8c2a56bdbdcc58c93db55902864da49f88a9f035e73ed610ab328ae0',
    file: 'public/design-system-samples/night-console.svg',
  },
  {
    id: 'soft-bloom',
    name: 'Soft Bloom — pastel and rounded',
    src: '/design-system-samples/soft-bloom.svg',
    sha256: 'c1ddeada6f34b2a5f87dfb23585b1ab8261aa05c37919dfc5f2f71fd378da6f7',
    file: 'public/design-system-samples/soft-bloom.svg',
  },
]

const t = (value: unknown, confidence: Confidence, assumption: string): ProposedToken => ({ value, confidence, assumption })

type CannedTokens = Record<TokenPath, ProposedToken>

const LEDGER: CannedTokens = {
  'color.background': t('#F6F1E7', 'high', 'Largest flat area of the image, behind every element.'),
  'color.surface': t('#FFFDF8', 'high', 'Fill of the bordered card and the text field.'),
  'color.text': t('#2B2118', 'high', 'Fill of the page title and the card title.'),
  'color.textMuted': t('#75685A', 'high', 'Fill of the subtitle, metadata line and placeholder.'),
  'color.primary': t('#8C3B1F', 'high', 'Fill of the only filled button, "Open draft".'),
  'color.onPrimary': t('#FFF8F0', 'high', 'Label color on the filled button.'),
  'color.border': t('#E3D8C6', 'high', 'Stroke of the card, the badge and the text field.'),
  'color.focus': t('#8C3B1F', 'medium', 'No focused element is shown; assumed the focus ring reuses the primary color.'),
  'font.body': t(['Helvetica Neue', 'Arial', 'sans-serif'], 'medium', 'Neo-grotesque sans at 12–15px; Helvetica Neue and Arial are visually close at this size.'),
  'font.heading': t(['Georgia', 'serif'], 'high', 'Transitional serif with ball terminals in the page title.'),
  'type.caption': t({ font: 'body', size: 12, lineHeight: 1.4, weight: 400, letterSpacing: 0 }, 'high', 'Metadata line under the card title.'),
  'type.body': t({ font: 'body', size: 15, lineHeight: 1.5, weight: 400, letterSpacing: 0 }, 'high', 'Subtitle and text-field placeholder; line height read from the subtitle block.'),
  'type.label': t({ font: 'body', size: 11, lineHeight: 1.3, weight: 500, letterSpacing: 0.05 }, 'high', 'Uppercase "DRAFT 2" badge, tracked out.'),
  'type.title': t({ font: 'heading', size: 28, lineHeight: 1.2, weight: 600, letterSpacing: -0.01 }, 'high', 'Page title "Quarterly letter".'),
  'space.xs': t(4, 'medium', 'Gap between the metadata line and the badge, rounded to a 4px grid.'),
  'space.sm': t(8, 'high', 'Gap between title and metadata inside the card.'),
  'space.md': t(16, 'high', 'Gap between the icon and the card text, and the text field to the button.'),
  'space.lg': t(24, 'high', 'Card inner padding.'),
  'space.xl': t(48, 'high', 'Page margin around the content.'),
  'radius.sm': t(2, 'high', 'Corner of the document icon.'),
  'radius.md': t(4, 'high', 'Corners of the button and the text field.'),
  'radius.lg': t(6, 'high', 'Corners of the card.'),
  'radius.pill': t(999, 'high', 'Fully rounded ends of the badge.'),
  'shadow.card': t(
    [
      { x: 0, y: 1, blur: 2, spread: 0, color: '#2B211814' },
      { x: 0, y: 6, blur: 16, spread: 0, color: '#2B21180F' },
    ],
    'medium',
    'Two soft layers read from the card edge; opacities estimated from a light background.',
  ),
  'shadow.raised': t(
    [{ x: 0, y: 10, blur: 24, spread: 0, color: '#2B21181F' }],
    'low',
    'No raised element (menu, dialog) is shown; extrapolated from the card shadow. Confirm or replace.',
  ),
  'size.icon': t(24, 'high', 'Document icon is 20×24px; using its larger side.'),
  'size.control': t(40, 'high', 'Height of the text field and the button.'),
}

const NIGHT_CONSOLE: CannedTokens = {
  'color.background': t('#0E1116', 'high', 'Largest flat area of the image, behind every element.'),
  'color.surface': t('#161B22', 'high', 'Fill of the bordered card and the command field.'),
  'color.text': t('#E6EDF3', 'high', 'Fill of the file name and the card title.'),
  'color.textMuted': t('#8B949E', 'high', 'Fill of the subtitle, metadata and prompt text.'),
  'color.primary': t('#3DDC97', 'high', 'Fill of the only filled button, "Open report".'),
  'color.onPrimary': t('#06281A', 'high', 'Label color on the filled button.'),
  'color.border': t('#2A313C', 'high', 'Stroke of the card, the badge and the command field.'),
  'color.focus': t('#3DDC97', 'low', 'No focused element is shown and the palette has one accent; assumed the focus ring uses it. Confirm.'),
  'font.body': t(['system-ui', 'sans-serif'], 'low', 'Sans text is 11–13px and too small to identify the face; only "a system sans" is certain.'),
  'font.heading': t(['Courier New', 'monospace'], 'high', 'Monospaced file name: every glyph has the same advance width.'),
  'type.caption': t({ font: 'body', size: 11, lineHeight: 1.4, weight: 400, letterSpacing: 0 }, 'high', 'Metadata line under the card title.'),
  'type.body': t({ font: 'body', size: 13, lineHeight: 1.5, weight: 400, letterSpacing: 0 }, 'high', 'Subtitle text.'),
  'type.label': t({ font: 'heading', size: 10, lineHeight: 1.3, weight: 400, letterSpacing: 0.04 }, 'high', '"DRAFT 1" badge set in the monospace face.'),
  'type.title': t({ font: 'heading', size: 24, lineHeight: 1.2, weight: 700, letterSpacing: 0 }, 'high', 'File name heading.'),
  'space.xs': t(4, 'high', 'Gap inside the badge.'),
  'space.sm': t(8, 'medium', 'Gap between title and metadata inside the card, rounded to a 4px grid.'),
  'space.md': t(16, 'high', 'Gap between the icon and the card text, and the command field to the button.'),
  'space.lg': t(20, 'high', 'Card inner padding.'),
  'space.xl': t(40, 'high', 'Page margin around the content.'),
  'radius.sm': t(0, 'high', 'Square corners on the badge and command field.'),
  'radius.md': t(2, 'high', 'Corners of the button.'),
  'radius.lg': t(2, 'high', 'Corners of the card.'),
  'radius.pill': t(2, 'low', 'No pill-shaped element is shown; assumed pills stay as square as everything else. Confirm.'),
  'shadow.card': t(null, 'low', 'No visible elevation. On a dark background a flat card and a dark shadow look the same, so this could not be read.'),
  'shadow.raised': t(null, 'low', 'No raised element (menu, dialog) is shown.'),
  'size.icon': t(20, 'high', 'Document icon is 16×20px; using its larger side.'),
  'size.control': t(36, 'high', 'Height of the command field and the button.'),
}

const SOFT_BLOOM: CannedTokens = {
  'color.background': t('#FFF5F7', 'high', 'Largest flat area of the image, behind every element.'),
  'color.surface': t('#FFFFFF', 'high', 'Fill of the card and the text field.'),
  'color.text': t('#3A2240', 'high', 'Fill of the page title and the card title.'),
  'color.textMuted': t('#8A6F8F', 'high', 'Fill of the subtitle, metadata and placeholder.'),
  'color.primary': t('#C2417A', 'high', 'Fill of the only filled button, "Open brief".'),
  'color.onPrimary': t('#FFFFFF', 'high', 'Label color on the filled button.'),
  'color.border': t('#F3D5E0', 'high', 'Stroke of the card, the badge and the text field.'),
  'color.focus': t('#C2417A', 'medium', 'No focused element is shown; assumed the focus ring reuses the primary color.'),
  'font.body': t(['Avenir Next', 'ui-rounded', 'sans-serif'], 'medium', 'Geometric sans with round bowls; Avenir Next is the closest common match.'),
  'font.heading': t(['Avenir Next', 'ui-rounded', 'sans-serif'], 'medium', 'Same face as the body, heavier.'),
  'type.caption': t({ font: 'body', size: 13, lineHeight: 1.4, weight: 400, letterSpacing: 0 }, 'high', 'Metadata line under the card title.'),
  'type.body': t({ font: 'body', size: 16, lineHeight: 1.5, weight: 400, letterSpacing: 0 }, 'high', 'Subtitle and text-field placeholder.'),
  'type.label': t({ font: 'body', size: 12, lineHeight: 1.3, weight: 600, letterSpacing: 0 }, 'high', '"Draft 3" badge.'),
  'type.title': t({ font: 'heading', size: 30, lineHeight: 1.2, weight: 700, letterSpacing: -0.01 }, 'high', 'Page title "Your moodboard".'),
  'space.xs': t(6, 'medium', 'Gap inside the badge.'),
  'space.sm': t(10, 'medium', 'Gap between title and metadata inside the card.'),
  'space.md': t(16, 'high', 'Gap between the text field and the button.'),
  'space.lg': t(28, 'high', 'Card inner padding.'),
  'space.xl': t(56, 'high', 'Page margin around the content.'),
  'radius.sm': t(8, 'low', 'Only one small rounded element (the icon) is shown, and it is a circle; 8px is a guess. Confirm or replace.'),
  'radius.md': t(13, 'high', 'Corners of the badge.'),
  'radius.lg': t(22, 'high', 'Corners of the card.'),
  'radius.pill': t(999, 'high', 'The text field and button have fully rounded ends.'),
  'shadow.card': t([{ x: 0, y: 8, blur: 24, spread: 0, color: '#C2417A24' }], 'high', 'One soft, tinted layer under the card.'),
  'shadow.raised': t([{ x: 0, y: 16, blur: 40, spread: 0, color: '#C2417A2E' }], 'low', 'No raised element is shown; extrapolated from the card shadow. Confirm or replace.'),
  'size.icon': t(28, 'high', 'Circular icon is 28px across.'),
  'size.control': t(48, 'high', 'Height of the text field and the button.'),
}

const CANNED: Record<string, { summary: string; assumptions: string[]; tokens: CannedTokens }> = {
  ledger: {
    summary: 'A light, warm editorial interface: serif headline, sans body, a bordered document card and one filled action.',
    assumptions: ['The image is a 1× screenshot, so 1 image pixel = 1 CSS pixel.', 'Colors are read from flat fills, not anti-aliased edges.'],
    tokens: LEDGER,
  },
  'night-console': {
    summary: 'A dark, flat developer-tool interface: monospace headings, square corners and one green accent.',
    assumptions: ['The image is a 1× screenshot, so 1 image pixel = 1 CSS pixel.', 'Colors are read from flat fills, not anti-aliased edges.'],
    tokens: NIGHT_CONSOLE,
  },
  'soft-bloom': {
    summary: 'A pastel consumer interface: rounded geometric sans, pill controls and soft tinted shadows.',
    assumptions: ['The image is a 1× screenshot, so 1 image pixel = 1 CSS pixel.', 'Colors are read from flat fills, not anti-aliased edges.'],
    tokens: SOFT_BLOOM,
  },
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

export function createMockExtractor(options: { latencyMs?: number } = {}): TokenExtractor {
  const latencyMs = options.latencyMs ?? 0
  return {
    id: 'mock-v1',
    async extract(image: DesignImage, { signal } = {}) {
      if (latencyMs > 0) await wait(latencyMs, signal)
      const digest = await sha256Hex(image.bytes)
      const sample = SAMPLE_IMAGES.find((s) => s.sha256 === digest)
      if (!sample) {
        throw new UnrecognizedImageError(
          'The offline extractor only recognizes the three sample images. A real image needs the model-backed extractor, which this build doesn’t include.',
        )
      }
      const canned = CANNED[sample.id]
      // A fresh copy each time, so a caller mutating the result can't change the canned data.
      return structuredClone({
        extractor: 'mock-v1',
        image: { name: image.name, width: 640, height: 420 },
        summary: canned.summary,
        assumptions: canned.assumptions,
        tokens: canned.tokens,
      })
    },
  }
}
