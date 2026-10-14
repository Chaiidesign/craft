// The bar plot as a self-contained SVG: same geometry as the preview's BarPlot
// and the PDF, with every label drawn as glyph outlines from the theme's TTFs,
// so the picture looks the same in any viewer and rasterises with no font
// lookup. Used for the chart picture in Word files (SVG, with a PNG fallback).

import type { PlanNode } from '../compose'
import { measure } from '../layout/text'
import type { BrandProfile } from '../model'
import { textPath } from '../outlines'
import { CHART, PRINT_TYPE, type TextStyle } from '../tokens'
import type { ExportResources } from './resources'

type ChartNode = Extract<PlanNode, { primitive: 'chart-with-data-summary' }>

export function chartPlotSvg(node: ChartNode, widthPt: number, heightPt: number, palette: BrandProfile['palette'], resources: ExportResources, labelStyle: TextStyle = PRINT_TYPE.label): string {
  const points = node.series[0]?.points ?? []
  const labels = node.valueLabels[0] ?? []
  const max = Math.max(1, ...points.map((p) => p.y))
  const w = widthPt, h = heightPt
  const top = CHART.valueLabelBandPt, bottom = CHART.axisLabelBandPt
  const band = w / Math.max(1, points.length)
  const parts: string[] = []
  const label = (text: string, cx: number, baseline: number) => {
    const width = measure(resources.fonts, text, labelStyle)
    parts.push(`<path fill="${palette.ink}" d="${textPath(resources.fonts, resources.fontBytes, text, labelStyle, cx - width / 2, baseline).d}"/>`)
  }
  parts.push(`<rect width="${w}" height="${h}" fill="#FFFFFF"/>`)
  parts.push(`<line x1="0" x2="${w}" y1="${h - bottom}" y2="${h - bottom}" stroke="${palette.ink}" stroke-width="${CHART.axisStrokePt}"/>`)
  points.forEach((p, i) => {
    const barH = ((h - bottom - top) * p.y) / max
    const barW = band * CHART.barShare
    const x = i * band + (band - barW) / 2
    parts.push(`<rect x="${x}" y="${h - bottom - barH}" width="${barW}" height="${barH}" fill="${palette.accent}"/>`)
    label(labels[i] ?? '', x + barW / 2, h - bottom - barH - CHART.valueLabelGapPt)
    label(p.x, x + barW / 2, h - bottom + CHART.axisLabelBandPt - CHART.valueLabelGapPt)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}pt" height="${h}pt" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`
}
