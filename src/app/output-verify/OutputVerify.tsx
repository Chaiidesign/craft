import Link from 'next/link'

import { formatMoney } from '@/lib/documents/money'
import { salesSummary } from '@/lib/output-system/fixtures/aggregates'
import { SAMPLE_DATA_LABEL, sampleStores } from '@/lib/output-system/fixtures/stores'
import { FORMAT_NOT_SUPPORTED, REGISTRY, type LaneStatus } from '@/lib/output-system/registry'

import styles from './outputVerify.module.css'

export const STATUS_LABEL: Record<LaneStatus, string> = {
  ready: 'Ready',
  'being-built': 'Being built',
  'coming-later': 'Coming later',
}

/** Ready first, then what is being built, then what comes later; router order within each. */
const STATUS_ORDER: Record<LaneStatus, number> = { ready: 0, 'being-built': 1, 'coming-later': 2 }

// Session 0 shell: what Souvenir can make, its state, and the sample stores.
// Making things from a request arrives in Session 1.
export function OutputVerify() {
  const stores = Object.values(sampleStores())
  const rows = [
    ...REGISTRY.map((e) => ({ key: e.lane, label: e.label, makes: e.makes, status: e.status })),
    { key: 'format-not-supported', label: 'Format not supported', makes: 'When a format won’t work, the closest formats to choose from.', status: FORMAT_NOT_SUPPORTED.status },
  ].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Make something</h1>
        <Link className={styles.link} href="/output-verify/gallery">Gallery</Link>
      </header>
      <p className={styles.sample}>{SAMPLE_DATA_LABEL}</p>

      <section aria-labelledby="request-heading" className={styles.section}>
        <h2 id="request-heading" className={styles.heading}>Your request</h2>
        <textarea
          className={styles.request}
          disabled
          rows={3}
          aria-describedby="request-note"
          placeholder="For example: Invoice Bloom & Co for 40 ceramic planters at $18 each."
        />
        <p id="request-note" className={styles.note}>Not ready yet. Making things from a request comes next.</p>
      </section>

      <section aria-labelledby="stores-heading" className={styles.section}>
        <h2 id="stores-heading" className={styles.heading}>Sample stores</h2>
        <ul className={styles.stores}>
          {stores.map((s) => {
            const year = salesSummary(s)
            return (
              <li key={s.id} className={styles.store}>
                <span className={styles.storeName}>{s.name}</span>
                <span className={styles.storeMeta}>
                  {s.currency} · {s.products.length} products · {s.customers.length} customers · {s.orders.length} orders
                </span>
                <span className={styles.storeMeta}>Sales in the last 12 months: {formatMoney({ amountMinor: year.revenueMinor, currency: s.currency }, s.locale)}</span>
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="kinds-heading" className={styles.section}>
        <h2 id="kinds-heading" className={styles.heading}>What Souvenir can make</h2>
        <ul className={styles.kinds}>
          {rows.map((r) => (
            <li key={r.key} className={styles.kind} data-status={r.status}>
              <span className={styles.kindLabel}>{r.label}</span>
              <span className={styles.kindMakes}>{r.makes}</span>
              <span className={styles.pill} data-status={r.status}>{STATUS_LABEL[r.status]}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
