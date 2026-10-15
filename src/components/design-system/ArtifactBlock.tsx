// ── ArtifactBlock ─────────────────────────────────────────────────────────────
// The chat message document block (src/components/chat/ArtifactCard.tsx),
// rebuilt from design-system primitives so an extracted design system reskins
// it. Same props and content as the original; the production card is untouched.
//
// One structural change: the original nests the "See history" button inside
// the clickable card's button, which is invalid HTML. Here the title is the
// card's button and a stretched ::after makes the whole card its target;
// "See history" sits above it as a sibling.

import React from 'react'
import { dsVar } from '@/lib/design-system/css-vars'
import { ArrowGlyph, Badge, Button, Card, DocumentGlyph, IconFrame, Text } from './primitives'

export interface ArtifactBlockProps {
  /** Glyph for the left slot; defaults to a document. Sized by the icon token. */
  icon?: React.ReactNode
  /** Title of the artifact, e.g. "Q1 Friction Report". */
  title: string
  /** Secondary metadata, e.g. "Notion · Saved 2 min ago". */
  meta?: string
  /** Makes the card open something; shows the arrow. */
  onOpen?: () => void
  /** When set, shows a "Draft v{N}" badge. */
  draftVersion?: number
  /** Shows "See history" next to the draft badge. */
  onViewHistory?: () => void
}

export function ArtifactBlock({ icon, title, meta, onOpen, draftVersion, onViewHistory }: ArtifactBlockProps) {
  const titleId = React.useId()
  const titleText = (
    <Text as="span" variant="body" emphasis truncate>
      {title}
    </Text>
  )
  return (
    <Card as="article" padding="md" labelledBy={titleId}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: onOpen ? `${dsVar('size-icon')} 1fr ${dsVar('size-icon')}` : `${dsVar('size-icon')} 1fr`,
          columnGap: dsVar('space-md'),
          alignItems: 'center',
        }}
      >
        <IconFrame>{icon ?? <DocumentGlyph />}</IconFrame>

        <div style={{ display: 'flex', flexDirection: 'column', gap: dsVar('space-xs'), minWidth: 0 }}>
          {onOpen ? (
            <button type="button" id={titleId} className="ds-stretched" onClick={onOpen}>
              {titleText}
            </button>
          ) : (
            <h3 id={titleId} style={{ margin: 0, minWidth: 0 }}>
              {titleText}
            </h3>
          )}
          {meta && (
            <Text variant="caption" tone="muted" truncate>
              {meta}
            </Text>
          )}
          {draftVersion != null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: dsVar('space-sm'), flexWrap: 'wrap' }}>
              <Badge>{`Draft v${draftVersion}`}</Badge>
              {onViewHistory && (
                <Button variant="link" onClick={onViewHistory}>
                  See history
                </Button>
              )}
            </div>
          )}
        </div>

        {onOpen && (
          <IconFrame>
            <ArrowGlyph />
          </IconFrame>
        )}
      </div>
    </Card>
  )
}
