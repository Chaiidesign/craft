// Templates: snapshot → document plan.
//
// A plan is an ordered list of nodes, one per layout primitive (PRD §6). It is
// renderer-neutral: the HTML preview renders it today; pagination (Step 3) and
// the PDF/DOCX/PPTX renderers (Step 5) read the same plan, so every surface
// shows the same words, numbers and missing states. All display text is
// derived here from typed values — nothing is regenerated per renderer.
//
// Every text-bearing node names its token style (`PrintTypeKey`), so renderers
// look typography up in tokens.ts rather than choosing it themselves.

import { BRIEF_FIELDS } from './brief'
import { describeFieldState, formatDate, formatFieldValue } from './display'
import { computeInvoiceTotals, INVOICE_FIELDS as F, isCommercial, type Amount } from './invoice'
import type { Block, BriefSnapshot, CalloutTone, ChartSeries, Citation, DocumentSnapshot, Field, FieldId, ImageAsset, InvoiceSnapshot, Money, TableColumn, TextRun } from './model'
import { formatMoney, formatPercent, formatQuantity } from './money'
import { contentWidthPt, type PrintTypeKey } from './tokens'
import { isUnbranded } from './templates/brand'
import { templateFor } from './templates/invoice'
import { validateSnapshot, type Readiness } from './validation'

// ── Plan types ───────────────────────────────────────────────────────────────

export type PlanRun = { text: string; emphasis: boolean; citations: readonly number[] }

/** A value slot that is either text or an explicit missing state (the MissingField primitive). */
export type PlanValue =
  | { kind: 'text'; text: string; style: PrintTypeKey }
  | { kind: 'missing'; fieldId?: FieldId; label: string; required: boolean }
  | { kind: 'unknown'; text: string; reasons: readonly string[]; style: PrintTypeKey }

export type KeyValueEntry = { fieldId: FieldId; label: string; value: PlanValue }

export type PlanNode =
  | { primitive: 'letterhead'; id: string; issuerName: string; accent: string; logo: { kind: 'image'; asset: ImageAsset; brokenNote: string } | { kind: 'none'; note: string } }
  | { primitive: 'title-block'; id: string; title: PlanValue; reference?: { label: string; value: PlanValue }; meta: readonly KeyValueEntry[]; draft: string | null }
  | { primitive: 'summary'; id: string; runs: readonly PlanRun[] }
  | { primitive: 'section-heading'; id: string; text: string; level: 1 | 2 | 3 }
  | { primitive: 'paragraph'; id: string; runs: readonly PlanRun[]; role: 'body' | 'pull-quote' }
  | { primitive: 'list'; id: string; ordered: boolean; items: readonly (readonly PlanRun[])[] }
  /** `keepWithPrevious`: never placed on a page apart from the block before it (invoice payment terms stay with the totals). */
  | { primitive: 'key-value-group'; id: string; title?: string; layout: 'stack' | 'columns' | 'parties'; entries: readonly KeyValueEntry[]; keepWithPrevious?: boolean }
  | { primitive: 'table'; id: string; caption?: string; columns: readonly TableColumn[]; rows: readonly { id: string; cells: readonly string[] }[]; citations: readonly number[] }
  | { primitive: 'invoice-line-items'; id: string; headers: { description: string; quantity: string; unitPrice: string; amount: string }; currencyNote: string | null; rows: readonly InvoiceRow[] }
  | { primitive: 'totals'; id: string; rows: readonly TotalsRow[]; grand: TotalsRow; complete: boolean }
  | { primitive: 'callout'; id: string; tone: CalloutTone; audience: 'recipient' | 'internal'; label: string | null; runs: readonly PlanRun[] }
  | { primitive: 'image-with-caption'; id: string; asset: ImageAsset; brokenNote: string; caption: string; citations: readonly number[] }
  | { primitive: 'chart-with-data-summary'; id: string; chartType: 'bar' | 'line'; title: string; unit: string; xLabel: string; yLabel: string; axesText: string; contentWidthPt: number; series: readonly ChartSeries[]; valueLabels: readonly (readonly string[])[]; dataSummary: string; citations: readonly number[] }
  | { primitive: 'source-list'; id: string; entries: readonly SourceEntry[] }
  | { primitive: 'page-break-hint'; id: string; kind: 'preferred' }
  /** `pageLabel` is a template; pagination fills {n} and {total}. */
  | { primitive: 'page-footer'; id: string; identification: string; pageLabel: string }

export type InvoiceRow = { id: string; description: PlanValue; quantity: string; unitPrice: PlanValue; amount: PlanValue }
export type TotalsRow = { id: string; label: string; value: PlanValue; negative?: boolean }
export type SourceEntry = { number: number; citationId: string; text: string; fictional: true }

export type PrimitiveName = PlanNode['primitive']

/** The 18 primitives PRD §6 requires. Citation and MissingField are inline primitives (runs / values). */
export const PRIMITIVES = [
  'Letterhead', 'TitleBlock', 'Summary', 'SectionHeading', 'Paragraph', 'List', 'KeyValueField', 'MissingField', 'Table',
  'InvoiceLineItems', 'Totals', 'Callout', 'ImageWithCaption', 'ChartWithDataSummary', 'Citation', 'SourceList', 'PageFooter', 'PageBreakHint',
] as const

export type Audience = 'recipient' | 'internal'

export interface DocumentPlan {
  kind: DocumentSnapshot['kind']
  themeId: string
  layoutPreset: DocumentSnapshot['layoutPreset']
  palette: DocumentSnapshot['brand']['palette']
  locale: string
  readiness: Readiness
  audience: Audience
  /** No blocks and no fields: renderers show an explanation, never a blank or half-built page. */
  empty: boolean
  nodes: readonly PlanNode[]
  /** Snapshot blocks the template placed; anything else was deliberately excluded (see `excludedBlocks`). */
  placedBlockIds: readonly string[]
  excludedBlocks: readonly { blockId: string; reason: string }[]
}

export interface ComposeOptions {
  /** `recipient` (default) leaves internal notes out, as recipient exports do. */
  audience?: Audience
}

// ── Shared helpers ───────────────────────────────────────────────────────────

const DRAFT_TEXT: Record<Exclude<Readiness, 'ready'>, string> = {
  incomplete: 'Draft — incomplete',
  invalid: 'Draft — needs correction',
}

function citationNumbers(snapshot: DocumentSnapshot): Map<string, number> {
  return new Map(snapshot.citations.map((c, i) => [c.id, i + 1]))
}

function planRuns(runs: readonly TextRun[], numbers: Map<string, number>): PlanRun[] {
  return runs.map((r) => ({
    text: r.text,
    emphasis: Boolean(r.emphasis),
    citations: (r.citationIds ?? []).map((id) => numbers.get(id)).filter((n): n is number => n !== undefined),
  }))
}

function fieldValue(snapshot: DocumentSnapshot, field: Field | undefined, fieldId: FieldId, style: PrintTypeKey): PlanValue {
  if (!field) return { kind: 'missing', fieldId, label: fieldId, required: true }
  if (field.state.status === 'provided') return { kind: 'text', text: formatFieldValue(field.state.value, snapshot.locale, field), style }
  if (field.state.status === 'not-applicable') return { kind: 'text', text: describeFieldState(field, snapshot.locale).text, style }
  return { kind: 'missing', fieldId, label: field.label, required: field.required }
}

/** Key/value entries for the given fields. Optional fields with no value are left out of the document; required ones show MissingField. */
function entries(snapshot: DocumentSnapshot, fieldIds: readonly FieldId[], styleFor: (field: Field | undefined) => PrintTypeKey = () => 'fieldValue'): KeyValueEntry[] {
  const out: KeyValueEntry[] = []
  for (const id of fieldIds) {
    const field = snapshot.fields[id]
    if (field && !field.required && field.state.status === 'missing') continue
    out.push({ fieldId: id, label: field?.label ?? id, value: fieldValue(snapshot, field, id, styleFor(field)) })
  }
  return out
}

/** The issuer's name for the letterhead and footer: the brand's, or for an unbranded document (D-61) the issuer field's, or nothing. */
function issuerLabel(snapshot: DocumentSnapshot): string {
  if (!isUnbranded(snapshot.brand)) return snapshot.brand.issuerDisplayName
  const issuer = snapshot.fields[F.issuerName]
  return issuer?.state.status === 'provided' ? formatFieldValue(issuer.state.value, snapshot.locale) : ''
}

/** No letterhead without a brand: an unbranded document (D-61) starts at its title, rather than showing an empty mark. */
function letterhead(snapshot: DocumentSnapshot): PlanNode[] {
  const { brand } = snapshot
  if (isUnbranded(brand)) return []
  return [{
    primitive: 'letterhead',
    id: 'letterhead',
    issuerName: brand.issuerDisplayName,
    accent: brand.palette.accent,
    logo: brand.logo
      ? { kind: 'image', asset: brand.logo, brokenNote: 'Logo could not be loaded' }
      : { kind: 'none', note: 'No logo supplied' },
  }]
}

function sourceText(c: Citation, locale: string): string {
  const parts = [c.title, c.publisher]
  if (c.date) parts.push(c.date.length === 10 ? formatDate(c.date, locale) : formatMonth(c.date, locale))
  if (c.locator) parts.push(c.locator)
  return parts.join('. ')
}

/** `YYYY-MM` → "July 2026" in the document locale. */
function formatMonth(yyyyMm: string, locale: string): string {
  const date = new Date(`${yyyyMm}-01T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return yyyyMm
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

const INTERNAL_LABEL = 'Internal note — not in recipient exports'

function calloutNode(block: Extract<Block, { type: 'callout' }>, numbers: Map<string, number>): PlanNode {
  return { primitive: 'callout', id: block.id, tone: block.tone, audience: block.audience, label: block.audience === 'internal' ? INTERNAL_LABEL : null, runs: planRuns(block.runs, numbers) }
}

function footer(identification: string): PlanNode {
  return { primitive: 'page-footer', id: 'footer', identification, pageLabel: 'Page {n} of {total}' }
}

// ── Invoice template (invoice@1) and the kinds built like it ─────────────────

const INVOICE_BLOCK_ROLES: Readonly<Record<string, string>> = {
  'blk-parties': 'Parties: letterhead + From/Bill to',
  'blk-details': 'Invoice details: title block reference + details',
  'blk-lines': 'Line items',
  'blk-adjustments': 'Discount and tax: shown in the totals rows they affect',
  'blk-totals': 'Totals',
  'blk-payment': 'Payment terms',
}

function amountValue(amount: Amount, locale: string, style: PrintTypeKey, negate = false): PlanValue {
  // Unknown amounts are words, not numerals, so they use the Function role.
  if (!amount.known) return { kind: 'unknown', text: 'Unknown', reasons: amount.reasons.map((r) => r.message), style: 'tableText' }
  const money: Money = negate ? { ...amount.money, amountMinor: -amount.money.amountMinor || 0 } : amount.money
  return { kind: 'text', text: formatMoney(money, locale), style }
}

function withoutReasons(v: PlanValue): PlanValue {
  return v.kind === 'unknown' ? { ...v, reasons: [] } : v
}

function composeInvoice(snapshot: InvoiceSnapshot, audience: Audience, readiness: Readiness): Pick<DocumentPlan, 'nodes' | 'placedBlockIds' | 'excludedBlocks'> {
  const { locale, fields } = snapshot
  const t = templateFor(snapshot.kind)
  // Fields added after invoice@1 was first made (shipping, order, paid by) are left out when a document doesn't have them.
  const own = (ids: readonly string[]) => ids.filter((id) => id in fields || !LATER_FIELDS.has(id))
  const totals = computeInvoiceTotals(snapshot)
  const nodes: PlanNode[] = [...letterhead(snapshot)]
  const placed: string[] = []
  const excluded: { blockId: string; reason: string }[] = []

  const numberField = fields[F.number]
  nodes.push({
    primitive: 'title-block',
    id: 'title',
    title: { kind: 'text', text: t.title, style: 'title' },
    reference: { label: numberField?.label ?? `${t.title} number`, value: fieldValue(snapshot, numberField, F.number, 'reference') },
    meta: entries(snapshot, own(t.meta), () => 'label'),
    draft: readiness === 'ready' ? null : DRAFT_TEXT[readiness],
  })

  for (const block of snapshot.blocks) {
    if (block.type === 'callout') {
      if (block.audience === 'internal' && audience === 'recipient') {
        excluded.push({ blockId: block.id, reason: 'Internal note — excluded from recipient documents.' })
        continue
      }
      nodes.push(calloutNode(block, new Map()))
      placed.push(block.id)
      continue
    }
    if (!(block.id in INVOICE_BLOCK_ROLES)) {
      excluded.push({ blockId: block.id, reason: `${snapshot.templateId} has no slot for a ${block.type} block.` })
      continue
    }
    placed.push(block.id)
    switch (block.id) {
      case 'blk-parties':
        nodes.push({ primitive: 'key-value-group', id: 'parties', layout: 'parties', entries: entries(snapshot, t.parties) })
        break
      case 'blk-details':
        nodes.push({ primitive: 'key-value-group', id: 'details', title: t.detailsTitle, layout: 'columns', entries: entries(snapshot, own(t.details), (f) => (f?.valueType === 'currency' || f?.id === F.poNumber || f?.id === F.orderNumber ? 'reference' : 'fieldValue')) })
        break
      case 'blk-lines': {
        if (block.type !== 'line-items') break
        const amountById = new Map(totals.lines.map((l) => [l.itemId, l.amount]))
        nodes.push({
          primitive: 'invoice-line-items',
          id: 'line-items',
          headers: { description: 'Description', quantity: 'Qty', unitPrice: 'Unit price', amount: 'Amount' },
          currencyNote: totals.currency ? `Amounts in ${totals.currency}` : null,
          rows: block.items.map((li) => ({
            id: li.id,
            description: li.description !== null ? { kind: 'text', text: li.description, style: 'tableText' } : { kind: 'missing', label: 'Description', required: true },
            // No-break space: a quantity never wraps away from its unit.
            quantity: `${formatQuantity(li.quantityMilli, locale)}${li.unit ? `\u00a0${li.unit}` : ''}`,
            unitPrice: li.unitPrice ? { kind: 'text', text: formatMoney(li.unitPrice, locale), style: 'amount' } : { kind: 'missing', label: 'Unit price', required: true },
            // The reason an amount is unknown is stated once, in the totals; the cell says only "Unknown".
            amount: withoutReasons(amountValue(amountById.get(li.id) ?? { known: false, reasons: [] }, locale, 'amount')),
          })),
        })
        break
      }
      case 'blk-totals':
        nodes.push(invoiceTotals(snapshot, totals, t.grandTotal))
        break
      case 'blk-payment': {
        const terms = entries(snapshot, own(t.terms))
        // An optional terms field left empty leaves no empty block behind.
        if (t.termsTitle && terms.length > 0) nodes.push({ primitive: 'key-value-group', id: 'payment', title: t.termsTitle, layout: 'stack', entries: terms, keepWithPrevious: true })
        break
      }
      // blk-adjustments: its fields are shown inside the totals rows they affect.
    }
  }

  const number = numberField?.state.status === 'provided' ? formatFieldValue(numberField.state.value, locale) : t.numberMissing
  nodes.push(footer([issuerLabel(snapshot), number].filter(Boolean).join(' · ')))
  return { nodes, placedBlockIds: placed, excludedBlocks: excluded }
}

const LATER_FIELDS = new Set<string>([F.shipping, F.orderNumber, F.paymentMethod])

function invoiceTotals(snapshot: InvoiceSnapshot, totals: ReturnType<typeof computeInvoiceTotals>, grandTotal: string): PlanNode {
  const { locale, fields } = snapshot
  const rows: TotalsRow[] = [{ id: 'subtotal', label: 'Subtotal', value: amountValue(totals.subtotal, locale, 'amount') }]

  const discountApplicability = fields[F.discountApplicability]
  const discountRate = fields[F.discountRate]
  if (discountApplicability?.state.status !== 'provided') {
    rows.push({ id: 'discount', label: 'Discount', value: { kind: 'missing', fieldId: F.discountApplicability, label: discountApplicability?.label ?? 'Discount', required: true } })
  } else if (discountApplicability.state.value.type === 'choice' && discountApplicability.state.value.option !== 'none') {
    const rate = discountRate?.state.status === 'provided' && discountRate.state.value.type === 'percent' ? ` (${formatPercent(discountRate.state.value.basisPoints, locale)})` : ''
    rows.push({ id: 'discount', label: `Discount${rate}`, value: amountValue(totals.discount, locale, 'amount', true), negative: true })
    rows.push({ id: 'taxable', label: 'Taxable amount', value: amountValue(totals.taxableBase, locale, 'amount') })
  }

  const taxApplicability = fields[F.taxApplicability]
  const taxRate = fields[F.taxRate]
  if (taxApplicability?.state.status !== 'provided') {
    rows.push({ id: 'tax', label: 'Tax', value: { kind: 'missing', fieldId: F.taxApplicability, label: taxApplicability?.label ?? 'Tax', required: true } })
  } else if (taxApplicability.state.value.type === 'choice' && taxApplicability.state.value.option === 'exempt') {
    rows.push({ id: 'tax', label: 'Tax (exempt)', value: amountValue(totals.tax, locale, 'amount') })
  } else {
    const rate = taxRate?.state.status === 'provided' && taxRate.state.value.type === 'percent' ? ` (${formatPercent(taxRate.state.value.basisPoints, locale)})` : ''
    rows.push({ id: 'tax', label: `Tax${rate}`, value: taxRate?.state.status === 'missing' ? { kind: 'missing', fieldId: F.taxRate, label: taxRate.label, required: true } : amountValue(totals.tax, locale, 'amount') })
  }

  if (totals.shipping) rows.push({ id: 'shipping', label: fields[F.shipping]?.label ?? 'Shipping', value: amountValue(totals.shipping, locale, 'amount') })

  const grand: TotalsRow = totals.total.known
    ? { id: 'total', label: grandTotal, value: amountValue(totals.total, locale, 'grandTotal') }
    : { id: 'total', label: 'Total', value: { kind: 'unknown', text: 'Incomplete — not a final amount', reasons: totals.total.reasons.map((r) => r.message), style: 'tableHeader' } }
  return { primitive: 'totals', id: 'totals', rows, grand, complete: totals.complete }
}

// ── Brief template (brief@1) ─────────────────────────────────────────────────

function composeBrief(snapshot: BriefSnapshot, audience: Audience, readiness: Readiness): Pick<DocumentPlan, 'nodes' | 'placedBlockIds' | 'excludedBlocks'> {
  const numbers = citationNumbers(snapshot)
  const titleField = snapshot.fields[BRIEF_FIELDS.title]
  const nodes: PlanNode[] = [
    ...letterhead(snapshot),
    {
      primitive: 'title-block',
      id: 'title',
      title: fieldValue(snapshot, titleField, BRIEF_FIELDS.title, 'title'),
      reference: snapshot.fields[BRIEF_FIELDS.reference]
        ? { label: snapshot.fields[BRIEF_FIELDS.reference].label, value: fieldValue(snapshot, snapshot.fields[BRIEF_FIELDS.reference], BRIEF_FIELDS.reference, 'reference') }
        : undefined,
      meta: entries(snapshot, [BRIEF_FIELDS.audience, BRIEF_FIELDS.preparedBy, BRIEF_FIELDS.date], () => 'label'),
      draft: readiness === 'ready' ? null : DRAFT_TEXT[readiness],
    },
  ]
  const placed: string[] = []
  const excluded: { blockId: string; reason: string }[] = []
  let sawHeading = false

  for (const block of snapshot.blocks) {
    const node = briefNode(block, snapshot, numbers)
    if (block.type === 'callout' && block.audience === 'internal' && audience === 'recipient') {
      excluded.push({ blockId: block.id, reason: 'Internal note — excluded from recipient documents.' })
      continue
    }
    if (!node) {
      excluded.push({ blockId: block.id, reason: `brief@1 has no slot for a ${block.type} block.` })
      continue
    }
    if (block.type === 'heading' && block.level <= 2) {
      if (sawHeading) nodes.push({ primitive: 'page-break-hint', id: `break-before-${block.id}`, kind: 'preferred' })
      sawHeading = true
    }
    nodes.push(node)
    placed.push(block.id)
  }

  const title = titleField?.state.status === 'provided' ? formatFieldValue(titleField.state.value, snapshot.locale) : 'Untitled brief'
  const reference = snapshot.fields[BRIEF_FIELDS.reference]
  const refText = reference?.state.status === 'provided' ? formatFieldValue(reference.state.value, snapshot.locale) : ''
  nodes.push(footer([issuerLabel(snapshot), refText, truncateForFooter(title)].filter(Boolean).join(' · ')))
  return { nodes, placedBlockIds: placed, excludedBlocks: excluded }
}

/** Footer identification only — the full title is always in the title block. */
function truncateForFooter(title: string): string {
  if (title.length <= 60) return title
  const cut = title.slice(0, 60)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`
}

function briefNode(block: Block, snapshot: DocumentSnapshot, numbers: Map<string, number>): PlanNode | null {
  const cites = (ids?: readonly string[]) => (ids ?? []).map((id) => numbers.get(id)).filter((n): n is number => n !== undefined)
  switch (block.type) {
    case 'heading':
      return { primitive: 'section-heading', id: block.id, text: block.text, level: block.level }
    case 'paragraph':
      return block.role === 'summary'
        ? { primitive: 'summary', id: block.id, runs: planRuns(block.runs, numbers) }
        : { primitive: 'paragraph', id: block.id, runs: planRuns(block.runs, numbers), role: block.role === 'pull-quote' ? 'pull-quote' : 'body' }
    case 'list':
      return { primitive: 'list', id: block.id, ordered: block.ordered, items: block.items.map((runs) => planRuns(runs, numbers)) }
    case 'field-group':
      return { primitive: 'key-value-group', id: block.id, title: block.title, layout: 'stack', entries: entries(snapshot, block.fieldIds) }
    case 'table':
      return { primitive: 'table', id: block.id, caption: block.caption, columns: block.columns, rows: block.rows.map((r) => ({ id: r.id, cells: block.columns.map((c) => r.cells[c.id] ?? '') })), citations: cites(block.citationIds) }
    case 'image':
      return { primitive: 'image-with-caption', id: block.id, asset: block.asset, brokenNote: `Image could not be loaded: ${block.asset.alt}`, caption: block.caption, citations: cites(block.citationIds) }
    case 'chart': {
      const format = new Intl.NumberFormat(snapshot.locale)
      return {
        primitive: 'chart-with-data-summary', id: block.id, chartType: block.chartType, title: block.title, unit: block.unit,
        xLabel: block.xLabel, yLabel: block.yLabel, series: block.series,
        axesText: `${block.xLabel} · ${block.yLabel} · Unit: ${block.unit}`,
        contentWidthPt: contentWidthPt(snapshot.layoutPreset),
        valueLabels: block.series.map((s) => s.points.map((p) => format.format(p.y))),
        dataSummary: block.dataSummary, citations: cites(block.citationIds),
      }
    }
    case 'callout':
      return calloutNode(block, numbers)
    case 'source-list':
      return { primitive: 'source-list', id: block.id, entries: snapshot.citations.map((c, i) => ({ number: i + 1, citationId: c.id, text: sourceText(c, snapshot.locale), fictional: true })) }
    case 'line-items':
    case 'totals':
      return null
  }
}

/** One snapshot block as a plan node, with the snapshot's citation numbering (used by deck layout). */
export function planNodeForBlock(snapshot: DocumentSnapshot, block: Block): PlanNode | null {
  return briefNode(block, snapshot, citationNumbers(snapshot))
}

// ── Entry point ──────────────────────────────────────────────────────────────

export class UnsupportedTemplateError extends Error {}

export function composeDocument(snapshot: DocumentSnapshot, options: ComposeOptions = {}): DocumentPlan {
  const audience = options.audience ?? 'recipient'
  const readiness = validateSnapshot(snapshot).readiness
  if (snapshot.blocks.length === 0 && snapshot.fieldOrder.length === 0) {
    return { kind: snapshot.kind, themeId: snapshot.brand.themeId, layoutPreset: snapshot.layoutPreset, palette: snapshot.brand.palette, locale: snapshot.locale, readiness, audience, empty: true, nodes: [], placedBlockIds: [], excludedBlocks: [] }
  }
  let body
  if (isCommercial(snapshot)) body = composeInvoice(snapshot, audience, readiness)
  else if (snapshot.kind === 'brief') body = composeBrief(snapshot, audience, readiness)
  else throw new UnsupportedTemplateError('Decks have no page template: derive one with deriveDeck() and lay it out with layoutDeck().')
  return {
    kind: snapshot.kind,
    themeId: snapshot.brand.themeId,
    layoutPreset: snapshot.layoutPreset,
    palette: snapshot.brand.palette,
    locale: snapshot.locale,
    readiness,
    audience,
    empty: false,
    ...body,
  }
}

// ── Text inventory (glyph coverage, later: renderer parity checks) ───────────

export type StyledText = { style: PrintTypeKey; text: string }

/** Every string the plan will draw, with the token style that draws it. */
export function collectStyledText(plan: DocumentPlan): StyledText[] {
  const out: StyledText[] = []
  const add = (style: PrintTypeKey, text: string) => { if (text) out.push({ style, text }) }
  const runs = (style: PrintTypeKey, rs: readonly PlanRun[]) => rs.forEach((r) => {
    add(r.emphasis ? 'emphasis' : style, r.text)
    if (r.citations.length) add('citation', citationMarker(r.citations))
  })
  const value = (v: PlanValue) => {
    if (v.kind === 'text') add(v.style, v.text)
    else if (v.kind === 'missing') add('label', missingText(v))
    else { add(v.style, v.text); v.reasons.forEach((r) => add('label', r)) }
  }
  for (const node of plan.nodes) {
    switch (node.primitive) {
      case 'letterhead': add('issuerName', node.issuerName); add('label', node.logo.kind === 'none' ? node.logo.note : node.logo.brokenNote); break
      case 'title-block':
        value(node.title)
        if (node.reference) { add('label', node.reference.label); value(node.reference.value) }
        node.meta.forEach((e) => { add('label', e.label); value(e.value) })
        if (node.draft) add('draftMarker', node.draft)
        break
      case 'summary': runs('body', node.runs); break
      case 'section-heading': add('sectionHeading', node.text); break
      case 'paragraph': runs(node.role === 'pull-quote' ? 'pullQuote' : 'body', node.runs); break
      case 'list': node.items.forEach((item, i) => { if (node.ordered) add('body', `${i + 1}.`); runs('body', item) }); break
      case 'key-value-group': if (node.title) add('label', node.title); node.entries.forEach((e) => { add('label', e.label); value(e.value) }); break
      case 'table': if (node.caption) add('label', node.caption); node.columns.forEach((c) => add('tableHeader', c.label)); node.rows.forEach((r) => r.cells.forEach((c, i) => add(node.columns[i]?.numeric ? 'amount' : 'tableText', c))); break
      case 'invoice-line-items':
        Object.values(node.headers).forEach((h) => add('tableHeader', h))
        if (node.currencyNote) add('label', node.currencyNote)
        node.rows.forEach((r) => { value(r.description); add('amount', r.quantity); value(r.unitPrice); value(r.amount) })
        break
      case 'totals': node.rows.forEach((r) => { add('tableText', r.label); value(r.value) }); add('tableHeader', node.grand.label); value(node.grand.value); break
      case 'callout': if (node.label) add('label', node.label); runs('body', node.runs); break
      case 'image-with-caption': add('label', node.brokenNote); add('label', node.caption); if (node.citations.length) add('citation', citationMarker(node.citations)); break
      case 'chart-with-data-summary':
        add('label', node.title); add('label', node.axesText)
        if (node.citations.length) add('citation', citationMarker(node.citations))
        node.series.forEach((s) => { add('label', s.label); s.points.forEach((p) => add('label', p.x)) })
        node.valueLabels.forEach((vs) => vs.forEach((v) => add('label', v)))
        add('label', node.dataSummary)
        break
      case 'source-list': node.entries.forEach((e) => add('citation', `${e.number}. ${e.text}`)); break
      case 'page-footer': add('footer', node.identification); add('footer', node.pageLabel.replace('{n}', '0123456789').replace('{total}', '0123456789')); break
      case 'page-break-hint': break
    }
  }
  return out
}

/** Inline citation marker, glued to its claim with no-break spaces so it never wraps alone. */
export function citationMarker(numbers: readonly number[]): string {
  return `\u00a0[${numbers.join(',\u00a0')}]`
}

export function missingText(v: Extract<PlanValue, { kind: 'missing' }>): string {
  return v.required ? `Missing — ${v.label}` : `Not supplied — ${v.label}`
}
