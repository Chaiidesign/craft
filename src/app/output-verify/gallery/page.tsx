import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import styles from '../outputVerify.module.css'

export const metadata: Metadata = {
  title: 'Output gallery (prototype)',
  robots: { index: false, follow: false },
}

// The best current example of every template, plus the two weakest results,
// with committed screenshots (build-loop.md §7). Empty until Session 1 adds the first.
export default function OutputGalleryPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Gallery</h1>
        <Link className={styles.link} href="/output-verify">Back to Make something</Link>
      </header>
      <p className={styles.empty}>
        No examples yet. The best example of each document and file appears here as it’s built, with the two weakest results beside them.
      </p>
    </main>
  )
}
