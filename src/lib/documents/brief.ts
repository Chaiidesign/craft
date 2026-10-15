// Brief template schema (`brief@1`): stable field IDs. Sections (summary,
// goals, constraints, evidence, recommendations, sources) are blocks.

import type { FieldId } from './model'

export const BRIEF_FIELDS = {
  title: 'brief.title',
  audience: 'brief.audience',
  preparedBy: 'brief.preparedBy',
  date: 'brief.date',
  reference: 'brief.reference',
} as const satisfies Record<string, FieldId>
