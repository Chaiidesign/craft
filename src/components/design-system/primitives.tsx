// ── Design-system primitives ──────────────────────────────────────────────────
// Every visual value here is a `var(--ds-…)` reference with no fallback, or a
// structural keyword (flex, none, 0, 100%…). The values themselves come only
// from the tokens a ThemeScope writes, so swapping the token JSON restyles
// everything. tokens-only.test.tsx enforces this on the rendered markup and on
// PRIMITIVE_STATE_CSS.

import React from 'react'
import { dsVar, textStyleVars, tokensToCssVars, type TextVariant } from '@/lib/design-system/css-vars'
import type { DesignTokens } from '@/lib/design-system/tokens'

/** Pseudo-states inline styles can't express. Scoped to ThemeScope, vars only. */
export const PRIMITIVE_STATE_CSS = `
[data-ds-scope] .ds-focusable:focus-visible {
  outline: var(--ds-size-focus-ring) solid var(--ds-color-focus);
  outline-offset: var(--ds-size-focus-ring);
}
[data-ds-scope] .ds-input::placeholder {
  color: var(--ds-color-text-muted);
}
[data-ds-scope] .ds-button:disabled {
  cursor: not-allowed;
  background: var(--ds-color-border);
  color: var(--ds-color-text-muted);
}
`

const border = `${dsVar('size-border')} solid ${dsVar('color-border')}`

// ── ThemeScope ────────────────────────────────────────────────────────────────

export interface ThemeScopeProps {
  tokens: DesignTokens
  children: React.ReactNode
  /** Accessible name for the region, e.g. the design system's name. */
  label?: string
}

/** Writes a token set as CSS variables; everything inside renders from it. */
export function ThemeScope({ tokens, children, label }: ThemeScopeProps) {
  const style = {
    ...tokensToCssVars(tokens),
    background: dsVar('color-background'),
    color: dsVar('color-text'),
    ...textStyleVars('body'),
    padding: dsVar('space-lg'),
  } as React.CSSProperties
  return (
    <div data-ds-scope="" role={label ? 'region' : undefined} aria-label={label} style={style}>
      <style href="ds-primitive-states" precedence="default">{PRIMITIVE_STATE_CSS}</style>
      {children}
    </div>
  )
}

// ── Text ──────────────────────────────────────────────────────────────────────

const TONE = {
  default: dsVar('color-text'),
  muted: dsVar('color-text-muted'),
  primary: dsVar('color-primary'),
} as const

export interface TextProps {
  variant?: TextVariant
  tone?: keyof typeof TONE
  as?: 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'div'
  /** One line, clipped with an ellipsis. */
  truncate?: boolean
  uppercase?: boolean
  children: React.ReactNode
  id?: string
}

export function Text({ variant = 'body', tone = 'default', as: Tag = 'p', truncate, uppercase, children, id }: TextProps) {
  return (
    <Tag
      id={id}
      style={{
        ...textStyleVars(variant),
        color: TONE[tone],
        margin: 0,
        textTransform: uppercase ? 'uppercase' : undefined,
        ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : null),
      }}
    >
      {children}
    </Tag>
  )
}

// ── Button ────────────────────────────────────────────────────────────────────

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className'> {
  variant?: 'primary' | 'secondary'
}

export function Button({ variant = 'primary', type = 'button', children, ...rest }: ButtonProps) {
  const primary = variant === 'primary'
  return (
    <button
      type={type}
      className="ds-button ds-focusable"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: dsVar('space-sm'),
        height: dsVar('size-control'),
        padding: `0 ${dsVar('space-lg')}`,
        borderRadius: dsVar('radius-md'),
        border: primary ? 'none' : border,
        background: primary ? dsVar('color-primary') : dsVar('color-surface'),
        color: primary ? dsVar('color-on-primary') : dsVar('color-text'),
        fontFamily: dsVar('type-body-family'),
        fontSize: dsVar('type-body-size'),
        lineHeight: dsVar('type-body-line-height'),
        fontWeight: dsVar('type-label-weight'),
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
      {...rest}
    >
      {children}
    </button>
  )
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'style' | 'className'> {
  label: string
}

export function Input({ label, id, ...rest }: InputProps) {
  const generated = React.useId()
  const inputId = id ?? generated
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: dsVar('space-xs'), flex: '1 1 0', minWidth: 0 }}>
      <label htmlFor={inputId} style={{ ...textStyleVars('caption'), color: dsVar('color-text-muted') }}>
        {label}
      </label>
      <input
        id={inputId}
        className="ds-input ds-focusable"
        style={{
          height: dsVar('size-control'),
          padding: `0 ${dsVar('space-md')}`,
          borderRadius: dsVar('radius-md'),
          border,
          background: dsVar('color-surface'),
          color: dsVar('color-text'),
          ...textStyleVars('body'),
          width: '100%',
          boxSizing: 'border-box',
          minWidth: 0,
        }}
        {...rest}
      />
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────

export interface CardProps {
  elevation?: 'card' | 'raised'
  padding?: 'md' | 'lg'
  children: React.ReactNode
  as?: 'div' | 'article' | 'section'
  labelledBy?: string
}

export function Card({ elevation = 'card', padding = 'lg', children, as: Tag = 'div', labelledBy }: CardProps) {
  return (
    <Tag
      aria-labelledby={labelledBy}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: dsVar('space-md'),
        padding: dsVar(padding === 'lg' ? 'space-lg' : 'space-md'),
        borderRadius: dsVar('radius-lg'),
        border,
        background: dsVar('color-surface'),
        boxShadow: dsVar(elevation === 'raised' ? 'shadow-raised' : 'shadow-card'),
        boxSizing: 'border-box',
        minWidth: 0,
      }}
    >
      {children}
    </Tag>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────

export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        alignSelf: 'flex-start',
        padding: `${dsVar('space-xs')} ${dsVar('space-sm')}`,
        borderRadius: dsVar('radius-pill'),
        border,
        background: dsVar('color-background'),
        color: dsVar('color-text-muted'),
        ...textStyleVars('label'),
      }}
    >
      {children}
    </span>
  )
}

// ── Icon frame ────────────────────────────────────────────────────────────────

/** A square slot sized by the icon token; the glyph inherits the muted color. */
export function IconFrame({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        flexShrink: 0,
        width: dsVar('size-icon'),
        height: dsVar('size-icon'),
        color: dsVar('color-text-muted'),
      }}
    >
      {children}
    </span>
  )
}

/** Outline document glyph. Geometry is shape data; its stroke width is a token. */
export function DocumentGlyph() {
  return (
    <svg viewBox="0 0 20 24" width="100%" height="100%" fill="none" stroke="currentColor" style={{ strokeWidth: dsVar('size-border') }}>
      <path vectorEffect="non-scaling-stroke" strokeLinejoin="round" d="M3 1h9l5 5v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" />
      <path vectorEffect="non-scaling-stroke" strokeLinejoin="round" d="M12 1v5h5M6 12h8M6 16h8M6 20h5" />
    </svg>
  )
}

// ── Stack ─────────────────────────────────────────────────────────────────────

export interface StackProps {
  direction?: 'row' | 'column'
  gap?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  align?: 'start' | 'center' | 'end' | 'stretch'
  wrap?: boolean
  children: React.ReactNode
}

/** Layout only: spacing between children, from the space tokens. */
export function Stack({ direction = 'column', gap = 'md', align = 'stretch', wrap, children }: StackProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: direction,
        gap: dsVar(`space-${gap}`),
        alignItems: align === 'start' || align === 'end' ? `flex-${align}` : align,
        flexWrap: wrap ? 'wrap' : undefined,
        minWidth: 0,
      }}
    >
      {children}
    </div>
  )
}
