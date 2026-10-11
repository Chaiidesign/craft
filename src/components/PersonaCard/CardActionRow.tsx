'use client'

import React from 'react'
import { m } from 'framer-motion'
import { ArrowRightTwoIcon } from '@strange-huge/icons'
import { AgentCardButton } from './AgentCardButton'
import { ACTION_HEIGHT } from './card-metrics'

export interface CardPrimaryAction {
  label: string
  onClick: () => void
  loading?: boolean
}

export interface CardActionRowProps {
  primary: CardPrimaryAction | null
  modelUnavailable: boolean
  /** The button's own hover/keyboard focus — the arrow appears only then, not on card hover. */
  ctaHot: boolean
  setCtaHot: (hot: boolean) => void
  /** Holds the avatar's eyes on the element (or releases them with null). */
  attendTo: (el: HTMLElement | null) => void
}

export function CardActionRow({ primary, modelUnavailable, ctaHot, setCtaHot, attendTo }: CardActionRowProps) {
  return (
  <div
    style={{
      height:         ACTION_HEIGHT,
      flexShrink:     0,
      boxSizing:      'border-box' as const,
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      // A hairline that fades out at both ends.
      backgroundImage:    primary && !modelUnavailable ? 'linear-gradient(90deg, transparent, var(--neutral-200), transparent)' : undefined,
      backgroundSize:     '100% 1px',
      backgroundPosition: 'top',
      backgroundRepeat:   'no-repeat',
      marginInline:   14,
    }}
  >
    {primary && !modelUnavailable && (
      <span
        className="agent-card-cta"
        onPointerEnter={e => { attendTo(e.currentTarget); setCtaHot(true) }}
        onPointerLeave={() => { attendTo(null); setCtaHot(false) }}
        onFocus={e => { if ((e.target as HTMLElement).matches(':focus-visible')) { attendTo(e.currentTarget); setCtaHot(true) } }}
        onBlur={() => { attendTo(null); setCtaHot(false) }}
      >
        <AgentCardButton size="sm" loading={primary.loading} disabled={primary.loading} onClick={primary.onClick}>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            {primary.label}
            {/* Slides in (and takes its room) only while the button is hot, so the label
                stays centred at rest: "go". */}
            <m.span
              aria-hidden
              initial={false}
              animate={{ width: ctaHot ? 20 : 0, opacity: ctaHot ? 1 : 0, x: ctaHot ? 0 : -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              style={{ display: 'inline-flex', justifyContent: 'flex-end', overflow: 'hidden' }}
            >
              <ArrowRightTwoIcon size={14} />
            </m.span>
          </span>
        </AgentCardButton>
      </span>
    )}
  </div>
  )
}
