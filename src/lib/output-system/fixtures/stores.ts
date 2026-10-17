// Sample store data for /output-verify (build-loop.md §5). Two fictional
// stores, one in INR and one in USD, each with 60 products, 200 customers and
// 500 orders over the 12 months to the anchor date. Everything is generated
// from a fixed seed and a fixed anchor date, never from "today", so the same
// code always gives the same data and every number in a reply can be
// recomputed from the orders (D-77).
//
// Sample data only: these stores, people and products are invented. Customer
// emails use example.com (reserved for documentation, RFC 2606).

import { SAFFRON_LOOM } from '../../documents/fixtures/brands'
import type { BrandProfile, CurrencyCode } from '../../documents/model'

export const SAMPLE_DATA_LABEL = 'Sample data: fictional stores, customers and orders'

/** Orders run for the 12 months up to and including this date. */
export const ANCHOR_DATE = '2026-09-30'

export type StoreId = 'saffron-loom' | 'fernhill-goods'

export type Product = {
  id: string
  sku: string
  title: string
  category: string
  /** Integer minor units (paise, cents). */
  priceMinor: number
  stock: number
  /** Stock at or below this is low. */
  reorderLevel: number
}

export type Customer = {
  id: string
  name: string
  email: string
  city: string
  country: string
  /** Full fictional billing address, as it prints: street, then city with region and postcode, then country. */
  address: readonly string[]
  /** YYYY-MM-DD */
  firstOrderOn: string | null
}

export type OrderLine = { productId: string; sku: string; title: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }

export type OrderStatus = 'fulfilled' | 'refunded' | 'cancelled'

export type Order = {
  id: string
  number: string
  /** YYYY-MM-DD */
  date: string
  customerId: string
  channel: 'online store' | 'marketplace' | 'social'
  status: OrderStatus
  lines: OrderLine[]
  /** All integer minor units. total = subtotal − discount + shipping + tax. */
  subtotalMinor: number
  discountMinor: number
  shippingMinor: number
  taxMinor: number
  totalMinor: number
  /** Tax rate in basis points (1% = 100). */
  taxRateBp: number
}

export type Store = {
  id: StoreId
  name: string
  currency: CurrencyCode
  country: string
  locale: string
  /** Default page size for its documents (assumed, D-73). */
  pageSize: 'a4-portrait' | 'letter-portrait'
  brand: BrandProfile
  /** The store's own postal address, as it prints on its documents. Fictional. */
  address: readonly string[]
  /** The tax rate the store charges on sales, in basis points (0 when it charges none). */
  taxRateBp: number
  products: Product[]
  customers: Customer[]
  orders: Order[]
}

/** A USD store has no brand profile among the document fixtures, so this one is new and fictional (D-77, assumed). Version 2 adds its fictional wordmark (Session 3). */
export const FERNHILL_GOODS_BRAND: BrandProfile = {
  profileId: 'brand-fernhill-goods',
  version: 2,
  issuerDisplayName: 'Fernhill Goods Co.',
  logo: { assetId: 'asset-fernhill-goods-wordmark', src: '/document-fixtures/fernhill-goods-wordmark.png', alt: 'Fernhill Goods Co. wordmark (fictional)', widthPx: 480, heightPx: 240 },
  assetStatus: 'supplied',
  palette: { ink: '#1C1B19', muted: '#5E5A53', rule: '#D9D4CB', accent: '#2F5D50' },
  themeId: 'placeholder',
}

/**
 * Saffron Loom's store profile: the document fixtures' SAFFRON_LOOM brand, version 2, with a fictional
 * wordmark. The fixture brand itself is unchanged, so /document-verify's invoices render as before.
 */
export const SAFFRON_LOOM_STORE_BRAND: BrandProfile = {
  ...SAFFRON_LOOM,
  version: 2,
  logo: { assetId: 'asset-saffron-loom-wordmark', src: '/document-fixtures/saffron-loom-wordmark.png', alt: 'Saffron Loom wordmark (fictional)', widthPx: 480, heightPx: 240 },
  assetStatus: 'supplied',
}

// ── Seeded generator ─────────────────────────────────────────────────────────

/** mulberry32: small, fast, deterministic. Not for anything secret. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)]
const int = (rand: () => number, min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
const pad = (n: number, w: number) => String(n).padStart(w, '0')

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Half-up rounding of an integer amount times basis points. */
function applyBp(amountMinor: number, bp: number): number {
  return Math.floor((amountMinor * bp + 5000) / 10000)
}

// ── Store definitions ────────────────────────────────────────────────────────

type StoreSpec = {
  id: StoreId
  seed: number
  name: string
  currency: CurrencyCode
  country: string
  locale: string
  pageSize: Store['pageSize']
  brand: BrandProfile
  address: readonly string[]
  skuPrefix: string
  orderPrefix: string
  /** [category, base titles, [min, max] price in major units] */
  catalog: [string, string[], [number, number]][]
  variants: string[]
  firstNames: string[]
  lastNames: string[]
  cities: string[]
  taxRateBp: number
  /** Flat shipping in major units, and the subtotal (major) at which it is free. */
  shipping: [number, number]
  /** Major units of currency per step when rounding prices (e.g. 10 rupees, or whole dollars). */
  priceStep: number
  /** Minor units subtracted from rounded prices (e.g. 1 → ₹x,xx9 or $x.99 style endings). */
  priceEnding: number
}

const SPECS: StoreSpec[] = [
  {
    id: 'saffron-loom',
    seed: 20261001,
    name: 'Saffron Loom Textiles',
    currency: 'INR',
    country: 'India',
    locale: 'en-IN',
    pageSize: 'a4-portrait',
    brand: SAFFRON_LOOM_STORE_BRAND,
    // The address Saffron Loom's fixture invoice already uses (fixtures/invoices.ts).
    address: ['Plot 22, Weavers’ Colony', 'Bhuj, Gujarat 370001', 'India'],
    skuPrefix: 'SLT',
    orderPrefix: 'SL',
    catalog: [
      ['Sarees', ['Handloom cotton saree', 'Silk-blend saree', 'Block-print saree'], [2400, 9800]],
      ['Stoles', ['Wool stole', 'Cotton stole', 'Ikat stole'], [900, 2600]],
      ['Cushion covers', ['Embroidered cushion cover', 'Kantha cushion cover', 'Woven cushion cover'], [450, 1400]],
      ['Table linen', ['Table runner', 'Napkin set of 4', 'Tablecloth'], [600, 3200]],
      ['Bedding', ['Cotton bedspread', 'Quilted dohar', 'Pillow cover pair'], [1200, 5400]],
    ],
    variants: ['Indigo', 'Madder red', 'Saffron', 'Ivory'],
    firstNames: ['Aarav', 'Ananya', 'Ishaan', 'Kavya', 'Rohan', 'Meera', 'Vikram', 'Diya', 'Arjun', 'Nisha', 'Kabir', 'Priya', 'Dev', 'Sana', 'Neel', 'Tara'],
    lastNames: ['Sharma', 'Iyer', 'Menon', 'Kapoor', 'Reddy', 'Bose', 'Nair', 'Gupta', 'Rao', 'Das', 'Joshi', 'Pillai'],
    cities: ['Bengaluru', 'Mumbai', 'Delhi', 'Chennai', 'Pune', 'Kolkata', 'Hyderabad', 'Jaipur'],
    taxRateBp: 500,
    shipping: [99, 1999],
    priceStep: 10,
    priceEnding: 0,
  },
  {
    id: 'fernhill-goods',
    seed: 20261002,
    name: 'Fernhill Goods Co.',
    currency: 'USD',
    country: 'United States',
    locale: 'en-US',
    pageSize: 'letter-portrait',
    brand: FERNHILL_GOODS_BRAND,
    address: ['Unit 4, 210 Alder Street', 'Asheville, NC 28801', 'United States'],
    skuPrefix: 'FHG',
    orderPrefix: 'FH',
    catalog: [
      ['Bags', ['Alpine 30L backpack', 'Ridge daypack', 'Summit duffel'], [48, 160]],
      ['Drinkware', ['Travel mug', 'Enamel camp mug', 'Insulated bottle'], [16, 42]],
      ['Home', ['Ceramic planter', 'Linen throw', 'Soy candle'], [18, 85]],
      ['Apparel', ['Linen summer dress', 'Straight-leg jeans', 'Merino crew'], [38, 128]],
      ['Outdoor', ['Camp blanket', 'Folding stool', 'Trail cap'], [22, 96]],
    ],
    variants: ['Forest', 'Sand', 'Charcoal', 'Rust'],
    firstNames: ['Avery', 'Jordan', 'Maya', 'Elena', 'Marcus', 'Priya', 'Owen', 'Hannah', 'Luis', 'Grace', 'Theo', 'Nora', 'Caleb', 'Ruth', 'Isaac', 'June'],
    lastNames: ['Bennett', 'Ortiz', 'Kim', 'Walsh', 'Hughes', 'Patel', 'Rivera', 'Coleman', 'Brooks', 'Nguyen', 'Foster', 'Lane'],
    cities: ['Portland', 'Denver', 'Austin', 'Chicago', 'Raleigh', 'Boise', 'Madison', 'Tucson'],
    taxRateBp: 0,
    shipping: [6, 75],
    priceStep: 1,
    priceEnding: 1,
  },
]

// ── Generation ───────────────────────────────────────────────────────────────

const MINOR = 100 // INR and USD both have two minor-unit digits.

function makeProducts(spec: StoreSpec, rand: () => number): Product[] {
  const products: Product[] = []
  let n = 1
  for (const [category, titles, [min, max]] of spec.catalog) {
    for (const base of titles) {
      for (const variant of spec.variants) {
        const major = Math.round(int(rand, min, max) / spec.priceStep) * spec.priceStep
        products.push({
          id: `${spec.id}-p${pad(n, 3)}`,
          sku: `${spec.skuPrefix}-${pad(n, 4)}`,
          title: `${base}, ${variant}`,
          category,
          priceMinor: major * MINOR - spec.priceEnding,
          stock: int(rand, 0, 140),
          reorderLevel: int(rand, 8, 25),
        })
        n++
      }
    }
  }
  return products
}

/** Fictional street names and each sample city's region and postcode prefix, for billing addresses. */
const ADDRESS_PARTS: Record<string, { streets: string[]; areas?: string[]; cities: Record<string, [region: string, postcodePrefix: string]> }> = {
  India: {
    streets: ['Gulmohar Lane', 'Peepal Tree Road', 'Mango Grove Street', 'Weavers’ Row', 'Lotus Court Road', 'Banyan Cross'],
    areas: ['Sector 4', 'Old Market', 'Lake View Colony', 'Station Road', 'Hill Park', 'Green Avenue'],
    cities: { Bengaluru: ['Karnataka', '560'], Mumbai: ['Maharashtra', '400'], Delhi: ['Delhi', '110'], Chennai: ['Tamil Nadu', '600'], Pune: ['Maharashtra', '411'], Kolkata: ['West Bengal', '700'], Hyderabad: ['Telangana', '500'], Jaipur: ['Rajasthan', '302'] },
  },
  'United States': {
    streets: ['Larch Street', 'Orchard Avenue', 'Millpond Road', 'Cedar Hollow Lane', 'Quarry Street', 'Juniper Way'],
    cities: { Portland: ['OR', '972'], Denver: ['CO', '802'], Austin: ['TX', '787'], Chicago: ['IL', '606'], Raleigh: ['NC', '276'], Boise: ['ID', '837'], Madison: ['WI', '537'], Tucson: ['AZ', '857'] },
  },
}

function billingAddress(country: string, city: string, rand: () => number): string[] {
  const parts = ADDRESS_PARTS[country]
  const [region, prefix] = parts.cities[city]
  const number = int(rand, 2, 480)
  const street = pick(rand, parts.streets)
  if (country === 'India') return [`${number}, ${street}, ${pick(rand, parts.areas!)}`, `${city}, ${region} ${prefix}${pad(int(rand, 1, 99), 3)}`, country]
  return [`${number} ${street}`, `${city}, ${region} ${prefix}${pad(int(rand, 1, 99), 2)}`, country]
}

function makeCustomers(spec: StoreSpec, rand: () => number): Customer[] {
  // Addresses come from their own seeded stream, so adding them changed none of the orders.
  const addressRand = seeded(spec.seed + 7)
  return Array.from({ length: 200 }, (_, i) => {
    const first = pick(rand, spec.firstNames)
    const last = pick(rand, spec.lastNames)
    const city = pick(rand, spec.cities)
    return {
      id: `${spec.id}-c${pad(i + 1, 3)}`,
      name: `${first} ${last}`,
      email: `${first}.${last}.${i + 1}@example.com`.toLowerCase(),
      city,
      country: spec.country,
      address: billingAddress(spec.country, city, addressRand),
      firstOrderOn: null,
    }
  })
}

function makeOrders(spec: StoreSpec, rand: () => number, products: Product[], customers: Customer[]): Order[] {
  const start = addDays(ANCHOR_DATE, -364)
  // Dates first, sorted, so order numbers rise with time.
  const dates = Array.from({ length: 500 }, () => addDays(start, int(rand, 0, 364))).sort()
  return dates.map((date, i) => {
    const lineCount = int(rand, 1, 3)
    const chosen = new Set<Product>()
    while (chosen.size < lineCount) chosen.add(pick(rand, products))
    const lines: OrderLine[] = [...chosen].map((p) => {
      const quantity = rand() < 0.8 ? 1 : int(rand, 2, 4)
      return { productId: p.id, sku: p.sku, title: p.title, quantity, unitPriceMinor: p.priceMinor, lineTotalMinor: p.priceMinor * quantity }
    })
    const subtotalMinor = lines.reduce((t, l) => t + l.lineTotalMinor, 0)
    const discountMinor = rand() < 0.15 ? applyBp(subtotalMinor, 1000) : 0
    const shippingMinor = subtotalMinor >= spec.shipping[1] * MINOR ? 0 : spec.shipping[0] * MINOR
    const taxMinor = applyBp(subtotalMinor - discountMinor, spec.taxRateBp)
    const r = rand()
    const status: OrderStatus = r < 0.04 ? 'cancelled' : r < 0.1 ? 'refunded' : 'fulfilled'
    return {
      id: `${spec.id}-o${pad(i + 1, 4)}`,
      number: `${spec.orderPrefix}-${pad(1001 + i, 5)}`,
      date,
      customerId: pick(rand, customers).id,
      channel: rand() < 0.7 ? 'online store' : rand() < 0.6 ? 'marketplace' : 'social',
      status,
      lines,
      subtotalMinor,
      discountMinor,
      shippingMinor,
      taxMinor,
      totalMinor: subtotalMinor - discountMinor + shippingMinor + taxMinor,
      taxRateBp: spec.taxRateBp,
    }
  })
}

function makeStore(spec: StoreSpec): Store {
  const rand = seeded(spec.seed)
  const products = makeProducts(spec, rand)
  const customers = makeCustomers(spec, rand)
  const orders = makeOrders(spec, rand, products, customers)
  const first = new Map<string, string>()
  for (const o of orders) if (!first.has(o.customerId)) first.set(o.customerId, o.date)
  for (const c of customers) c.firstOrderOn = first.get(c.id) ?? null
  return {
    id: spec.id,
    name: spec.name,
    currency: spec.currency,
    country: spec.country,
    locale: spec.locale,
    pageSize: spec.pageSize,
    brand: spec.brand,
    address: spec.address,
    taxRateBp: spec.taxRateBp,
    products,
    customers,
    orders,
  }
}

let cache: Record<StoreId, Store> | undefined

/** Both sample stores, generated once per process. */
export function sampleStores(): Record<StoreId, Store> {
  cache ??= Object.fromEntries(SPECS.map((s) => [s.id, makeStore(s)])) as Record<StoreId, Store>
  return cache
}

export function sampleStore(id: StoreId): Store {
  return sampleStores()[id]
}
