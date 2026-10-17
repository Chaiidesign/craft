import { describe, expect, it } from 'vitest'

import { toRuns } from './RichText'

describe('chat reply text', () => {
  it('splits a lead line and a list in the same block', () => {
    expect(toRuns('Two things caused the drop:\n- **Fewer orders:** 38\n- Smaller baskets\n\nNext paragraph.')).toEqual([
      { kind: 'p', lines: ['Two things caused the drop:'] },
      { kind: 'ul', lines: ['**Fewer orders:** 38', 'Smaller baskets'] },
      { kind: 'p', lines: ['Next paragraph.'] },
    ])
  })

  it('reads numbered lists and headings', () => {
    expect(toRuns('## Top three\n1. A\n2. B')).toEqual([{ kind: 'h', lines: ['Top three'] }, { kind: 'ol', lines: ['A', 'B'] }])
  })
})
