// Brief → deck adaptation (PRD §7, fixture 5).
//
// A deck is derived from one exact brief revision: the caller passes the
// source output and revision IDs, and they are recorded on the result.
// revisions.ts (deriveDeckRevision / checkAncestry) stores decks as revisions
// and verifies those IDs against real brief revisions.
//
// Adaptation changes hierarchy, not facts: every recipient-facing block keeps
// its words, numbers and citations. Nothing is summarised (so no slide sets
// `summaryOf`); dense sections are split across slides by the layout engine.
// Internal notes are left out, as in recipient documents.

import type { Block, BlockId, BriefSnapshot, DeckSnapshot, OutputId, RevisionId, SlidePlan } from './model'

export interface DeckSource {
  outputId: OutputId
  revisionId: RevisionId
}

export interface DerivedDeck {
  snapshot: DeckSnapshot
  derivedFrom: DeckSource
  excludedBlocks: readonly { blockId: BlockId; reason: string }[]
}

export function deriveDeck(brief: BriefSnapshot, source: DeckSource): DerivedDeck {
  const excludedBlocks: { blockId: BlockId; reason: string }[] = []
  const blocks: Block[] = []
  for (const block of brief.blocks) {
    if (block.type === 'callout' && block.audience === 'internal') {
      excludedBlocks.push({ blockId: block.id, reason: 'Internal note — excluded from the recipient deck.' })
      continue
    }
    blocks.push(block)
  }

  // Sections: a heading (level ≤ 2) and the blocks up to the next one.
  const sections: Block[][] = []
  for (const block of blocks) {
    if (block.type === 'heading' && block.level <= 2) sections.push([block])
    else if (sections.length) sections[sections.length - 1].push(block)
    else sections.push([block])
  }

  const slides: SlidePlan[] = [{ id: 'slide-title', layout: 'title', blockIds: [] }]
  for (const section of sections) {
    const heading = section[0].type === 'heading' ? section[0] : null
    const rest = heading ? section.slice(1) : section
    if (rest.some((b) => b.type === 'source-list')) {
      slides.push({ id: `slide-${section[0].id}`, layout: 'closing', blockIds: section.map((b) => b.id) })
      continue
    }
    // A chart gets a slide of its own; the section's other blocks keep their order around it.
    let run: Block[] = heading ? [heading] : []
    let part = 0
    const flush = () => {
      const content = run.filter((b) => b.type !== 'heading')
      if (content.length) slides.push({ id: `slide-${section[0].id}-${part++}`, layout: 'content', blockIds: run.map((b) => b.id) })
      run = heading ? [heading] : []
    }
    for (const block of rest) {
      if (block.type === 'chart') {
        flush()
        slides.push({ id: `slide-${block.id}`, layout: 'chart', blockIds: [...(heading ? [heading.id] : []), block.id] })
        continue
      }
      run.push(block)
    }
    flush()
  }

  return {
    snapshot: {
      ...brief,
      kind: 'deck',
      templateId: 'deck@1',
      blocks,
      layoutPreset: 'slide-16x9',
      slides,
    },
    derivedFrom: { ...source },
    excludedBlocks,
  }
}
