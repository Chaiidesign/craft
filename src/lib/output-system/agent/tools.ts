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
import { kindName, StrictDocumentInputSchema, UpdateDocumentInputSchema } from '../strict'

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

export const ExportVersionInputSchema = z.object({
  format: z.string().min(1).max(40).describe('The format the person named, e.g. PDF or Word.'),
  version: z.number().int().min(1).optional().describe('A version number the person named. Leave it out for the current version.'),
})

/** Every other making action, for kinds this build loop doesn't build. */
export const LaterInputSchema = z.object({ summary: z.string().min(1).max(300).describe('One line: what you would make.') })

export const TERMINAL: Record<string, { lane: Lane | 'format_not_supported' | 'export' | 'update'; schema: z.ZodType }> = {
  build_file: { lane: 'file', schema: BuildFileInputSchema },
  show_format_options: { lane: 'format_not_supported', schema: FormatOptionsInputSchema },
  show_message_card: { lane: 'message_card', schema: LaterInputSchema },
  show_chart: { lane: 'inline_chart', schema: ChartSpecSchema },
  create_strict_document: { lane: 'strict_document', schema: StrictDocumentInputSchema },
  update_document: { lane: 'update', schema: UpdateDocumentInputSchema },
  create_document: { lane: 'composed_document', schema: LaterInputSchema },
  create_design: { lane: 'design', schema: LaterInputSchema },
  create_dashboard: { lane: 'dashboard', schema: LaterInputSchema },
  publish_page: { lane: 'published_page', schema: LaterInputSchema },
  export_version: { lane: 'export', schema: ExportVersionInputSchema },
}

const DESCRIPTIONS: Record<string, string> = {
  build_file: 'Make a file from store data (orders, products or customers as Excel, CSV, JSON or PDF), or change a file the person uploaded. Store files: pick the dataset, format and filters; the rows come from the store. Uploads: list the changes; they are applied to every row and the file keeps its columns and format.',
  show_format_options: 'Tell the person the thing they asked for can’t be made in the format they named, and offer the closest formats.',
  show_message_card: 'Draft a message for a particular person or list.',
  show_chart: 'Show a quick chart of store numbers in the conversation: weekly or monthly sales, or top products. Pick what to chart, give it a title in words and a one- or two-sentence lead that answers the question; the points come from the store.',
  create_strict_document: 'Make an invoice, quote, purchase order or receipt with exact facts. Store facts are copied, never typed: name an order (fromOrder) for an invoice or receipt of a customer’s order, or catalogue SKUs (products) for lines; look them up first with ask_store (find_order, customer_orders, find_products). The store’s name, address, currency, today’s date and its usual tax are filled in for you. For anything else the person stated, add operations that quote their exact words. Leave out what they didn’t say: it is shown as Missing, which is correct. For a policy or another document with exact terms, use type "other" with a one-line summary.',
  update_document: 'Change the document already made in this conversation. It becomes a new version; the earlier versions are kept. Change only what the person asked for, quoting each field’s or line’s digest from the current document.',
  create_document: 'Make a document to keep or share: a plan, report, brief or spec sheet.',
  create_design: 'Make a design: an ad, social post, banner, mockup or slides.',
  create_dashboard: 'Make a dashboard for numbers checked repeatedly.',
  publish_page: 'Publish an interactive page: a calculator, size guide or quiz.',
  export_version: 'Export the current version of something already made (or a version the person names), in a named format.',
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
export function progressLabel(tool: string, input: unknown, current?: string): string {
  if (tool === 'ask_store') return 'Checking your store data'
  if (tool === 'create_strict_document') {
    const parsed = StrictDocumentInputSchema.shape.type.safeParse((input as { type?: unknown } | null)?.type)
    if (parsed.success && parsed.data !== 'other') return `Making your ${kindName(parsed.data)}`
  }
  if (tool === 'update_document') return current ? `Changing your ${current}` : 'Changing your document'
  if (tool === 'export_version') return current ? `Exporting your ${current}` : 'Exporting your document'
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
