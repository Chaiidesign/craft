'use client'

import { useEffect, useId, useRef, useState } from 'react'

import { chartCsv, type Chart } from '@/lib/output-system/chart'

import styles from './outputVerify.module.css'

// An inline chart, drawn as SVG that scales to its container (inline-chart
// guide): a title in words, bars from zero, a value label on every bar, one
// data colour (the store's accent), a source line, and a text summary for
// screen readers. Downloads: CSV of the numbers, PNG of the picture.

const ROW = 30
const PAD = 8

/** The chart is drawn at its container's real width, so text stays at its set size on a phone. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.max(260, Math.round(el.getBoundingClientRect().width)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function ChartView({ chart, accent, ink, muted }: { chart: Chart; accent: string; ink: string; muted: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [boxRef, boxWidth] = useWidth(600)
  const titleId = useId()
  const max = Math.max(1, ...chart.points.map((p) => p.value))
  const fileBase = chart.title.replace(/[\\/:*?"<>|]+/g, ' ').trim()
  const font = 'system-ui, sans-serif'

  let width: number
  let height: number
  let body: React.ReactNode
  if (chart.orientation === 'horizontal') {
    width = boxWidth
    const stacked = width < 480
    // On a phone each name sits above its bar, so names are never cut short.
    const rowH = stacked ? 48 : ROW
    height = chart.points.length * rowH + PAD * 2
    const LABEL_W = stacked ? 0 : Math.min(210, Math.round(width * 0.42))
    const maxChars = Math.floor(LABEL_W / 7.2)
    const plot = width - LABEL_W - 72
    body = chart.points.map((p, i) => {
      if (stacked) {
        const y = PAD + i * rowH
        const w = (plot * p.value) / max
        return (
          <g key={p.label}>
            <text x={0} y={y + 14} fontSize="13" fill={ink} fontFamily={font}>{p.label}</text>
            <rect x={0} y={y + 22} width={Math.max(1, w)} height={18} fill={accent} />
            <text x={w + 6} y={y + 36} fontSize="13" fill={ink} fontFamily={font}>{p.display}</text>
          </g>
        )
      }
      const y = PAD + i * ROW
      const w = (plot * p.value) / max
      return (
        <g key={p.label}>
          <text x={LABEL_W - 8} y={y + ROW / 2 + 5} textAnchor="end" fontSize="13" fill={ink} fontFamily={font}>{p.label.length > maxChars ? `${p.label.slice(0, maxChars - 1)}…` : p.label}</text>
          <rect x={LABEL_W} y={y + 5} width={Math.max(1, w)} height={ROW - 10} fill={accent} />
          <text x={LABEL_W + w + 6} y={y + ROW / 2 + 5} fontSize="13" fill={ink} fontFamily={font}>{p.display}</text>
        </g>
      )
    })
  } else {
    width = boxWidth
    height = width < 480 ? 220 : 260
    const top = 24
    const bottom = 30
    const band = width / chart.points.length
    // A full value label needs about 76 px. Narrower bars get the short form ("$3.03K");
    // below about 40 px, label every other bar, always including the last.
    const compact = band < 76
    const every = band >= 40 ? 1 : 2
    // Date labels ("14 Sept") need about 56 px each; narrower, every other one, always the last.
    const axisEvery = band >= 56 ? 1 : 2
    const valueText = (p: Chart['points'][number]) => (compact || chart.chartType === 'line' ? p.short : p.display)
    const yOf = (v: number) => height - bottom - ((height - bottom - top) * v) / max
    // Lines label only the first, last, highest and lowest points; bars label every bar (or every other when narrow).
    const values = chart.points.map((p) => p.value)
    const hi = values.indexOf(Math.max(...values))
    const lo = values.indexOf(Math.min(...values))
    const lineLabels = new Set([0, chart.points.length - 1, hi, lo])
    const showValue = (i: number) => (chart.chartType === 'line' ? lineLabels.has(i) : (chart.points.length - 1 - i) % every === 0)
    const labelY = (i: number, v: number) => (chart.chartType === 'line' && i === lo && i !== hi ? yOf(v) + 18 : yOf(v) - 8)
    body = (
      <>
        <line x1="0" x2={width} y1={height - bottom} y2={height - bottom} stroke={muted} strokeWidth="1" />
        {chart.chartType === 'line' ? (
          <polyline fill="none" stroke={accent} strokeWidth="2.5" points={chart.points.map((p, i) => `${i * band + band / 2},${yOf(p.value)}`).join(' ')} />
        ) : null}
        {chart.points.map((p, i) => {
          const cx = i * band + band / 2
          const barW = band * 0.64
          return (
            <g key={`${p.label}-${i}`}>
              {chart.chartType === 'bar' ? <rect x={cx - barW / 2} y={yOf(p.value)} width={barW} height={height - bottom - yOf(p.value)} fill={accent} /> : <circle cx={cx} cy={yOf(p.value)} r="3.5" fill={accent} />}
              {showValue(i) ? <text x={Math.min(Math.max(cx, 24), width - 24)} y={labelY(i, p.value)} textAnchor="middle" fontSize="12" fill={ink} fontFamily={font}>{valueText(p)}</text> : null}
              {(chart.points.length - 1 - i) % axisEvery === 0 ? <text x={cx > width - 28 ? width : cx < 28 ? 0 : cx} y={height - bottom + 18} textAnchor={cx > width - 28 ? 'end' : cx < 28 ? 'start' : 'middle'} fontSize="12" fill={muted} fontFamily={font}>{p.label}</text> : null}
            </g>
          )
        })}
      </>
    )
  }

  function png() {
    const svg = svgRef.current
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = width * scale
      canvas.height = height * scale
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((b) => b && save(`${fileBase}.png`, b), 'image/png')
    }
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
  }

  return (
    <figure className={styles.chart} aria-labelledby={titleId}>
      <figcaption id={titleId} className={styles.cardTitle}>{chart.title}</figcaption>
      <div ref={boxRef}>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${chart.title}. ${chart.points.map((p) => `${p.label}: ${p.display}`).join('; ')}.`}>
        <rect width={width} height={height} fill="#FFFFFF" />
        {body}
      </svg>
      </div>
      <p className={styles.cardMeta}>{chart.source}</p>
      <div className={styles.formatButtons}>
        <button type="button" className={styles.secondary} onClick={png}>Download PNG</button>
        <button type="button" className={styles.secondary} onClick={() => save(`${fileBase}.csv`, new Blob([chartCsv(chart)], { type: 'text/csv' }))}>Download CSV</button>
      </div>
    </figure>
  )
}
