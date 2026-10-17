// The tools the model is offered on /output-verify: the prompt's own action
// names (D-80). read_guide and ask_store answer and the loop continues; every
// other action ends the turn with something to show. Kinds not built in this
// build loop still have their tool, and the app shows "coming later" for them;
// the model is never told they are missing.

import { z } from 'zod'

import { ChartSpecSchema } from '../chart'
import { FileSpecSchema } from '../files/datasets'
import { UploadChangeSchema } from '../files/upload'
import { LANES, type Lane } from '../lanes'
import { STORE_TOOL } from '../storeTool'

export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> }

const schema = (s: z.ZodType) => {
  const out = z.toJSONSchema(s) as Record<string, unknown>
  delete out.$schema
  return out
}

export const GuideInputSchema = z.object({ type: z.enum(LANES).describe('The kind of thing you are about to make.') })

/**
 * One flat object, because the API refuses a union at the top of a tool schema.
 * Store files need dataset and format; upload changes need changes. Checked in
 * code (superRefine), and the error goes back to the model once.
 */
export const BuildFileInputSchema = FileSpecSchema.partial()
  .extend({
    source: z.enum(['store', 'upload']).describe('store: a file made from store data. upload: changes to the file the person uploaded.'),
    changes: z.array(UploadChangeSchema).min(1).max(8).optional().describe('upload only: the changes, applied in order.'),
    note: z.string().max(200).optional().describe('One line for the person about what the file contains.'),
  })
  .superRefine((v, ctx) => {
    if (v.source === 'store') {
      if (!v.dataset) ctx.addIssue({ code: 'custom', path: ['dataset'], message: 'Required for a store file.' })
      if (!v.format) ctx.addIssue({ code: 'custom', path: ['format'], message: 'Required for a store file.' })
      if (v.changes) ctx.addIssue({ code: 'custom', path: ['changes'], message: 'Only for source "upload".' })
    } else if (!v.changes) ctx.addIssue({ code: 'custom', path: ['changes'], message: 'Required for source "upload".' })
  })

export const FormatOptionsInputSchema = z.object({
  thing: z.enum(LANES).describe('The kind of thing that was asked for.'),
  requestedFormat: z.string().min(1).max(40),
  offered: z.array(z.string().min(1).max(40)).min(1).max(4).describe('The closest formats, closest first, from the guide’s format list.'),
  message: z.string().min(1).max(300).describe('One or two sentences for the person: what can’t be made in that format, and what can.'),
})

/** Every other making action, for kinds this build loop doesn't build. */
export const LaterInputSchema = z.object({ summary: z.string().min(1).max(300).describe('One line: what you would make.') })

export const TERMINAL: Record<string, { lane: Lane | 'format_not_supported' | 'export'; schema: z.ZodType }> = {
  build_file: { lane: 'file', schema: BuildFileInputSchema },
  show_format_options: { lane: 'format_not_supported', schema: FormatOptionsInputSchema },
  show_message_card: { lane: 'message_card', schema: LaterInputSchema },
  show_chart: { lane: 'inline_chart', schema: ChartSpecSchema },
  create_strict_document: { lane: 'strict_document', schema: LaterInputSchema },
  create_document: { lane: 'composed_document', schema: LaterInputSchema },
  create_design: { lane: 'design', schema: LaterInputSchema },
  create_dashboard: { lane: 'dashboard', schema: LaterInputSchema },
  publish_page: { lane: 'published_page', schema: LaterInputSchema },
  export_version: { lane: 'export', schema: LaterInputSchema },
}

const DESCRIPTIONS: Record<string, string> = {
  build_file: 'Make a file from store data (orders, products or customers as Excel, CSV, JSON or PDF), or change a file the person uploaded. Store files: pick the dataset, format and filters; the rows come from the store. Uploads: list the changes; they are applied to every row and the file keeps its columns and format.',
  show_format_options: 'Tell the person the thing they asked for can’t be made in the format they named, and offer the closest formats.',
  show_message_card: 'Draft a message for a particular person or list.',
  show_chart: 'Show a quick chart of store numbers in the conversation: weekly or monthly sales, or top products. Pick what to chart, give it a title in words and a one- or two-sentence lead that answers the question; the points come from the store.',
  create_strict_document: 'Make an invoice, quote, purchase order, receipt, policy or other document with exact facts.',
  create_document: 'Make a document to keep or share: a plan, report, brief or spec sheet.',
  create_design: 'Make a design: an ad, social post, banner, mockup or slides.',
  create_dashboard: 'Make a dashboard for numbers checked repeatedly.',
  publish_page: 'Publish an interactive page: a calculator, size guide or quiz.',
  export_version: 'Export the current version of something already made, in a named format.',
}

export const READ_GUIDE: ToolDef = {
  name: 'read_guide',
  description: 'Read the guide for the kind of thing you are about to make: layout rules, tone, examples and which formats it can be exported to. Read it before making anything.',
  input_schema: schema(GuideInputSchema),
}

const withoutSchemaKey = (s: Record<string, unknown>) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== '$schema'))

export function toolDefs(): ToolDef[] {
  return [
    READ_GUIDE,
    { name: STORE_TOOL.name, description: STORE_TOOL.description, input_schema: withoutSchemaKey(STORE_TOOL.input_schema as Record<string, unknown>) },
    ...Object.entries(TERMINAL).map(([name, t]) => ({ name, description: DESCRIPTIONS[name], input_schema: schema(t.schema) })),
  ]
}

/** What the person sees while each step runs (words-on-screen rules apply; tested). */
export function progressLabel(tool: string, input: unknown): string {
  if (tool === 'ask_store') return 'Checking your store data'
  const lane = tool === 'read_guide' ? (input as { type?: string } | null)?.type : TERMINAL[tool]?.lane
  switch (lane) {
    case 'file':
      return 'Making your file'
    case 'chat_reply':
      return 'Writing your answer'
    case 'strict_document':
    case 'composed_document':
      return 'Making your document'
    case 'message_card':
      return 'Writing your message'
    case 'inline_chart':
      return 'Making your chart'
    case 'design':
      return 'Making your design'
    case 'dashboard':
      return 'Making your dashboard'
    case 'published_page':
      return 'Making your page'
    case 'format_not_supported':
      return 'Checking which formats work'
    default:
      return 'Working on it'
  }
}
