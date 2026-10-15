'use client'

// Error screen for one workbench section. A crash in a preview, export panel
// or inspector shows what happened in place of that section — never a blank
// workbench — and the revision store, which lives above every boundary, is
// untouched. "Try again" renders the section afresh and moves focus to its
// first heading, since the button that had focus is gone.

import React from 'react'

import { Button } from '@/components/Button'

import styles from './workbench.module.css'

interface Props { children: React.ReactNode; label: string }
interface State { error: Error | null }

export class SectionBoundary extends React.Component<Props, State> {
  state: State = { error: null }
  private readonly box = React.createRef<HTMLDivElement>()
  private retried = false

  componentDidUpdate() {
    if (!this.retried || this.state.error) return
    this.retried = false
    const heading = this.box.current?.querySelector<HTMLElement>('h2, h3')
    if (!heading) return
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1
    heading.focus()
  }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  render() {
    const { error } = this.state
    if (!error) return <div ref={this.box} style={{ display: 'contents' }}>{this.props.children}</div>
    return (
      <section className={styles.panel} role="alert" aria-label={this.props.label} data-section-error="">
        <p className={styles.formError} style={{ marginTop: 0 }}>This section hit an error: {error.message.replace(/\.$/, '')}. Your revisions are unchanged.</p>
        <div className={styles.toolbar}><Button size="sm" variant="outline" onClick={() => { this.retried = true; this.setState({ error: null }) }}>Try again</Button></div>
      </section>
    )
  }
}
