// Invoice fixtures (PRD §11: 1, 2, 3 and 10). All fictional sample data.

import { DISCOUNT_OPTIONS, INVOICE_FIELDS as F, TAX_OPTIONS } from '../invoice'
import type { BrandProfile, CurrencyCode, InvoiceLineItem, InvoiceSnapshot } from '../model'
import { invoiceSnapshot } from '../templates/invoice'
import {
  HALDEN_ROWE,
  MARROW_FINCH,
  NORTHERN_COOPERATIVE_LONG_NAME,
  PELL_DARROW_NO_LOGO,
  QUILLON_BROKEN_LOGO,
  SAFFRON_LOOM,
} from './brands'
import {
  choice,
  currency,
  date,
  item,
  lines,
  m,
  missing,
  notApplicable,
  percent,
  provided,
  text,
} from './builders'

const taxChoices = TAX_OPTIONS
const discountChoices = DISCOUNT_OPTIONS

// ── Fixture 1: complete branded invoice ─────────────────────────────────────
//
// Expected arithmetic (USD, half-up, per-line rounding):
//   Brand identity system      1     × 4,800.00 = 480,000¢
//   Design-system workshop     12.5h ×   185.00 = 231,250¢
//   Printed proof set          3     ×    64.99 =  19,497¢
//   Subtotal                                    = 730,747¢   $7,307.47
//   Discount 5%   730,747 × 500/10,000 = 36,537.35 → 36,537¢  −$365.37
//   Taxable base                                = 694,210¢   $6,942.10
//   Tax 8.25%     694,210 × 825/10,000 = 57,272.325 → 57,272¢  $572.72
//   Total                                       = 751,482¢   $7,514.82

export const FIXTURE_1_EXPECTED = {
  lines: [480_000, 231_250, 19_497],
  subtotal: 730_747,
  discount: 36_537,
  taxableBase: 694_210,
  tax: 57_272,
  total: 751_482,
  currency: 'USD' as CurrencyCode,
}

export function completeInvoice(brand: BrandProfile = HALDEN_ROWE, locale = 'en-US'): InvoiceSnapshot {
  return invoiceSnapshot({
    brand,
    locale,
    fields: [
      provided(F.issuerName, 'Issuer', text(brand.issuerDisplayName)),
      provided(F.issuerAddress, 'Issuer address', lines('41 Larkspur Row, Suite 3', 'Portland, OR 97209', 'United States')),
      provided(F.buyerName, 'Bill to', text('Corvid Lane Coffee Co.')),
      provided(F.buyerAddress, 'Billing address', lines('1180 Ember Street', 'Tacoma, WA 98402', 'United States')),
      provided(F.number, 'Invoice number', text('HRS-2026-0142')),
      provided(F.issueDate, 'Invoice date', date('2026-09-30')),
      provided(F.dueDate, 'Due date', date('2026-10-30')),
      provided(F.poNumber, 'Purchase order', text('CLC-PO-7781'), { required: false }),
      provided(F.currency, 'Currency', currency('USD')),
      provided(F.discountApplicability, 'Discount', choice('percent'), { choices: discountChoices }),
      provided(F.discountRate, 'Discount rate', percent(500)),
      provided(F.taxApplicability, 'Tax', choice('applicable'), { choices: taxChoices }),
      provided(F.taxRate, 'Tax rate', percent(825)),
      provided(F.paymentTerms, 'Payment terms', text('Net 30. Bank transfer to the account on the remittance slip.')),
    ],
    items: [
      item('li-1', 'Brand identity system — logo suite, colour and type guidelines', 1_000, m(480_000, 'USD')),
      item('li-2', 'Design-system workshop facilitation', 12_500, m(18_500, 'USD'), 'hours'),
      item('li-3', 'Printed proof set, uncoated stock', 3_000, m(6_499, 'USD'), 'sets'),
    ],
    internalNote: 'Internal: confirm the workshop hours with Corvid Lane before sending. Not for the recipient.',
  })
}

// ── Fixture 2: missing address, due date and tax applicability ─────────────
//
// Subtotal is known (EUR 1,677.50 = 167,750 cents) but tax applicability was
// not supplied, so tax and total are unknown — not zero.

export const FIXTURE_2_EXPECTED = { subtotal: 167_750, currency: 'EUR' as CurrencyCode }

export function incompleteInvoice(): InvoiceSnapshot {
  return invoiceSnapshot({
    brand: MARROW_FINCH,
    locale: 'en-IE',
    fields: [
      provided(F.issuerName, 'Issuer', text(MARROW_FINCH.issuerDisplayName)),
      provided(F.issuerAddress, 'Issuer address', lines('Unit 7, Kilnworks Yard', 'Galway H91 X2Y4', 'Ireland')),
      provided(F.buyerName, 'Bill to', text('Oakhurst Community Hall')),
      missing(F.buyerAddress, 'Billing address', 'multiline'),
      provided(F.number, 'Invoice number', text('MFJ-0388')),
      provided(F.issueDate, 'Invoice date', date('2026-10-02')),
      missing(F.dueDate, 'Due date', 'date'),
      missing(F.poNumber, 'Purchase order', 'text', { required: false }),
      provided(F.currency, 'Currency', currency('EUR')),
      provided(F.discountApplicability, 'Discount', choice('none'), { choices: discountChoices }),
      notApplicable(F.discountRate, 'Discount rate', 'percent', 'discount-when-none'),
      missing(F.taxApplicability, 'Tax', 'choice', { choices: taxChoices }),
      missing(F.taxRate, 'Tax rate', 'percent'),
      provided(F.paymentTerms, 'Payment terms', text('Payment within 14 days of the due date.')),
    ],
    items: [
      item('li-1', 'Oak bench, 1.8 m, oiled finish', 2_000, m(64_000, 'EUR')),
      item('li-2', 'On-site installation', 6_500, m(4_800, 'EUR'), 'hours'),
      item('li-3', 'Hard-wax oil top-up kit', 1_000, m(8_550, 'EUR')),
    ],
  })
}

// ── Fixture 3: long invoice ────────────────────────────────────────────────
//
// 42 rows with long descriptions and one very tall row (index 17), INR with
// Indian digit grouping. Rows are generated deterministically — no randomness.

const FABRICS = [
  'Handloom cotton dhurrie, natural undyed',
  'Block-printed linen table runner, indigo resist',
  'Khadi bedcover, double, hand-finished edges',
  'Ikat cushion cover, 45 × 45 cm, zip closure',
  'Jute floor mat, braided border, entrance size',
  'Silk-blend stole, kalamkari hand-painted motif',
  'Organic cotton bath towel, 600 GSM, waffle weave',
  'Wool-blend throw, herringbone, fringed ends',
  'Chanderi curtain panel, 2.4 m drop, tab top',
  'Mulmul napkin set of six, hemstitched',
  'Ajrakh-printed quilt, single, reversible',
  'Bandhani bolster cover, 60 cm, tie closure',
  'Hand-knotted rug, 1.2 × 1.8 m, low pile',
  'Cotton duck laundry bag, drawstring, embroidered label',
]

const SITES = ['Lobby', 'Guest floor 3', 'Guest floor 4', 'Restaurant']

export const TALL_ROW_ID = 'li-18'

const TALL_DESCRIPTION = [
  'Bespoke commission: hand-woven tapestry for the main lobby wall, 3.6 × 2.4 m, in five panels joined on site.',
  'Includes two rounds of colour sampling against the lobby stone, a full-scale cartoon approved by the client’s design lead, mounting battens, concealed hanging hardware, a conservation-grade backing cloth, and a care manual.',
  'Weaving schedule: twelve weeks across three looms. Panels are delivered rolled on acid-free tubes and installed by two weavers over two days.',
  'Quoted price covers materials, weaving, finishing and installation; it excludes scaffolding, which the client supplies.',
].join(' ')

export function longInvoiceItems(): InvoiceLineItem[] {
  return Array.from({ length: 42 }, (_, i) => {
    const id = `li-${i + 1}`
    if (id === TALL_ROW_ID) return item(id, TALL_DESCRIPTION, 1_000, m(48_500_000, 'INR'))
    const fabric = FABRICS[i % FABRICS.length]
    const site = SITES[i % SITES.length]
    const quantityMilli = ((i * 7) % 23 + 2) * 1_000
    const unitPaise = 45_000 + ((i * 31_337) % 900_000) // ₹450.00 – ₹9,449.99
    return item(id, `${fabric} — for ${site.toLowerCase()} refit, batch ${String(i + 1).padStart(2, '0')}`, quantityMilli, m(unitPaise, 'INR'))
  })
}

export function longInvoice(): InvoiceSnapshot {
  return invoiceSnapshot({
    brand: SAFFRON_LOOM,
    locale: 'en-IN',
    fields: [
      provided(F.issuerName, 'Issuer', text(SAFFRON_LOOM.issuerDisplayName)),
      provided(F.issuerAddress, 'Issuer address', lines('Plot 22, Weavers’ Colony', 'Bhuj, Gujarat 370001', 'India')),
      provided(F.buyerName, 'Bill to', text('Kestrel Hotels Group')),
      provided(F.buyerAddress, 'Billing address', lines('Kestrel House, 9 Marine Lines', 'Mumbai, Maharashtra 400020', 'India')),
      provided(F.number, 'Invoice number', text('SLT/26-27/0917')),
      provided(F.issueDate, 'Invoice date', date('2026-10-05')),
      provided(F.dueDate, 'Due date', date('2026-11-04')),
      provided(F.poNumber, 'Purchase order', text('KHG-REFIT-2026-14'), { required: false }),
      provided(F.currency, 'Currency', currency('INR')),
      provided(F.discountApplicability, 'Discount', choice('none'), { choices: discountChoices }),
      notApplicable(F.discountRate, 'Discount rate', 'percent', 'discount-when-none'),
      provided(F.taxApplicability, 'Tax', choice('applicable'), { choices: taxChoices }),
      provided(F.taxRate, 'Tax rate (GST)', percent(1_800)),
      provided(F.paymentTerms, 'Payment terms', text('50% on delivery, balance within 30 days. NEFT/RTGS to the account on the remittance slip.')),
    ],
    items: longInvoiceItems(),
  })
}

// ── Fixture 10: brand fallback ─────────────────────────────────────────────
//
// Same invoice content as fixture 1 (in GBP), under three issuer profiles:
// no logo supplied, a "supplied" logo whose file is broken, and a very long
// issuer name. Each must render a stable, labelled neutral fallback.

function brandVariant(brand: BrandProfile): InvoiceSnapshot {
  const base = completeInvoice(brand, 'en-GB')
  const fields = { ...base.fields }
  fields[F.currency] = provided(F.currency, 'Currency', currency('GBP'))
  fields[F.issuerAddress] = provided(F.issuerAddress, 'Issuer address', lines('12 Fenwick Yard', 'Leeds LS2 7EY', 'United Kingdom'))
  fields[F.taxRate] = provided(F.taxRate, 'Tax rate (VAT)', percent(2_000))
  const blocks = base.blocks.map((block) => block.type === 'line-items'
    ? { ...block, items: block.items.map((li) => ({ ...li, unitPrice: li.unitPrice && { ...li.unitPrice, currency: 'GBP' as const } })) }
    : block)
  return { ...base, fields, blocks }
}

export const brandNoLogoInvoice = () => brandVariant(PELL_DARROW_NO_LOGO)
export const brandBrokenLogoInvoice = () => brandVariant(QUILLON_BROKEN_LOGO)
export const brandLongNameInvoice = () => brandVariant(NORTHERN_COOPERATIVE_LONG_NAME)
