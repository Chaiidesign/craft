// Document font themes. THIS IS THE ONLY FILE THAT NAMES A FONT FAMILY.
// tokens.ts reads the active theme; CSS variables, the preview and every
// exporter read tokens. Swapping a placeholder family is a one-file edit here
// (plus dropping the new TTFs + licence into ./fonts). A test fails if a family
// name appears anywhere else under src/.
//
// The four families below are SIL OFL placeholders. The final pick is deferred
// to an A/B render of the same fixture in candidate themes (see
// docs/documents/README.md). Static TTFs only, committed unmodified with their
// licences; no variable fonts, so PDF/DOCX embedding gets exactly these cuts.

export type FontRole = 'voice' | 'display' | 'function' | 'money'
export type FontWeight = 400 | 500 | 600
export type FontStyle = 'normal' | 'italic'

export type ThemeFace = {
  role: FontRole
  weight: FontWeight
  style: FontStyle
  /** File under src/lib/documents/fonts/, unmodified from the foundry release. */
  file: string
  /** Resolved asset URL (bundled by Next; file:// under Vitest). */
  url: URL
  /** Name-table strings, verified against the TTF by theme.test.ts. Exporters that
      reference fonts by name (DOCX, PPTX) must use these exactly. */
  nameTable: { family: string; subfamily: string; postscript: string }
}

export type ThemeRole = {
  /** Typographic family (name ID 16, else 1). Used for CSS and as the logical family in exports. */
  family: string
  /** Generic fallback when the face cannot load. Recorded, never silently relied on for exports. */
  generic: 'serif' | 'sans-serif' | 'monospace'
  /** Where the family comes from, for the README and export reports. */
  source: string
  licence: string
}

export type DocumentTheme = {
  id: string
  label: string
  roles: Record<FontRole, ThemeRole>
  faces: ThemeFace[]
}

// Each URL must be a literal `new URL('./…', import.meta.url)` so the bundler emits the asset.
const placeholderFaces: ThemeFace[] = [
  {
    role: 'voice', weight: 400, style: 'normal', file: 'Newsreader16pt-Regular.ttf',
    url: new URL('./fonts/Newsreader16pt-Regular.ttf', import.meta.url),
    nameTable: { family: 'Newsreader 16pt', subfamily: 'Regular', postscript: 'Newsreader16pt-Regular' },
  },
  {
    role: 'voice', weight: 400, style: 'italic', file: 'Newsreader16pt-Italic.ttf',
    url: new URL('./fonts/Newsreader16pt-Italic.ttf', import.meta.url),
    nameTable: { family: 'Newsreader 16pt', subfamily: 'Italic', postscript: 'Newsreader16pt-Italic' },
  },
  {
    role: 'voice', weight: 600, style: 'normal', file: 'Newsreader16pt-SemiBold.ttf',
    url: new URL('./fonts/Newsreader16pt-SemiBold.ttf', import.meta.url),
    nameTable: { family: 'Newsreader 16pt SemiBold', subfamily: 'Regular', postscript: 'Newsreader16pt-SemiBold' },
  },
  {
    role: 'display', weight: 600, style: 'normal', file: 'ArchivoSemiCondensed-SemiBold.ttf',
    url: new URL('./fonts/ArchivoSemiCondensed-SemiBold.ttf', import.meta.url),
    nameTable: { family: 'Archivo SemiCondensed SemiBold', subfamily: 'Regular', postscript: 'ArchivoSemiCondensed-SemiBold' },
  },
  {
    role: 'function', weight: 400, style: 'normal', file: 'IBMPlexSans-Regular.ttf',
    url: new URL('./fonts/IBMPlexSans-Regular.ttf', import.meta.url),
    nameTable: { family: 'IBM Plex Sans', subfamily: 'Regular', postscript: 'IBMPlexSans' },
  },
  {
    role: 'function', weight: 500, style: 'normal', file: 'IBMPlexSans-Medium.ttf',
    url: new URL('./fonts/IBMPlexSans-Medium.ttf', import.meta.url),
    nameTable: { family: 'IBM Plex Sans Medm', subfamily: 'Regular', postscript: 'IBMPlexSans-Medm' },
  },
  {
    role: 'money', weight: 400, style: 'normal', file: 'IBMPlexMono-Regular.ttf',
    url: new URL('./fonts/IBMPlexMono-Regular.ttf', import.meta.url),
    nameTable: { family: 'IBM Plex Mono', subfamily: 'Regular', postscript: 'IBMPlexMono' },
  },
  {
    role: 'money', weight: 500, style: 'normal', file: 'IBMPlexMono-Medium.ttf',
    url: new URL('./fonts/IBMPlexMono-Medium.ttf', import.meta.url),
    nameTable: { family: 'IBM Plex Mono Medm', subfamily: 'Regular', postscript: 'IBMPlexMono-Medm' },
  },
]

export const PLACEHOLDER_THEME: DocumentTheme = {
  id: 'placeholder',
  label: 'Placeholder (OFL): Newsreader / Archivo / IBM Plex',
  roles: {
    voice: { family: 'Newsreader 16pt', generic: 'serif', source: 'productiontype/Newsreader fonts/static/ttf (16pt text cut)', licence: 'Newsreader-OFL.txt' },
    display: { family: 'Archivo SemiCondensed', generic: 'sans-serif', source: 'Omnibus-Type/Archivo fonts/ttf', licence: 'Archivo-OFL.txt' },
    function: { family: 'IBM Plex Sans', generic: 'sans-serif', source: 'IBM/plex release @ibm/plex-sans@1.1.0', licence: 'IBMPlexSans-OFL.txt' },
    money: { family: 'IBM Plex Mono', generic: 'monospace', source: 'IBM/plex release @ibm/plex-mono@2.5.0', licence: 'IBMPlexMono-OFL.txt' },
  },
  faces: placeholderFaces,
}

export const THEMES: Record<string, DocumentTheme> = {
  [PLACEHOLDER_THEME.id]: PLACEHOLDER_THEME,
}

export const DEFAULT_THEME_ID = PLACEHOLDER_THEME.id

/** Unknown theme IDs resolve to the default and say so — the caller decides whether to surface it. */
export function resolveTheme(themeId: string | undefined): { theme: DocumentTheme; fellBack: boolean } {
  const theme = themeId ? THEMES[themeId] : undefined
  return theme ? { theme, fellBack: false } : { theme: THEMES[DEFAULT_THEME_ID], fellBack: true }
}

export function faceFor(theme: DocumentTheme, role: FontRole, weight: FontWeight, style: FontStyle = 'normal'): ThemeFace | undefined {
  return theme.faces.find((f) => f.role === role && f.weight === weight && f.style === style)
}
