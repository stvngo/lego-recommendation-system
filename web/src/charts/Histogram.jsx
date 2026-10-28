import { useState } from 'react'
import { compact, linearScale, niceTicks, topRoundedBar } from './scale.js'
import { Tooltip } from './parts.jsx'
import { useWidth } from './useWidth.js'

const M = { top: 22, right: 12, bottom: 38, left: 36 }
const MAX_BAR = 24
const GAP = 2

/**
 * Columns over equal-width bins. bins: { counts, edges } (edges has counts.length + 1 values).
 * cutoff: optional x value marked with a hairline (e.g. the 5th pick's score).
 */
export default function Histogram({ bins, color, cutoff, cutoffLabel, format, xLabel, height = 220 }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)

  const { counts, edges } = bins
  const lo = edges[0]
  const hi = edges[edges.length - 1]
  const sx = linearScale([lo, hi], [M.left, width - M.right])
  const maxCount = Math.max(...counts, 1)
  const yTicks = niceTicks(0, maxCount, 3)
  const sy = linearScale([0, yTicks[yTicks.length - 1]], [height - M.bottom, M.top])
  const band = (width - M.left - M.right) / counts.length
  const barW = Math.max(1, Math.min(MAX_BAR, band - GAP))
  const xTicks = [lo, (lo + hi) / 2, hi]

  const bar = i => {
    const x = M.left + i * band + (band - barW) / 2
    const top = sy(counts[i])
    return { x, top, h: height - M.bottom - top }
  }

  return (
    <div ref={ref} className="chart" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} onPointerLeave={() => setHover(null)}>
          {yTicks.map(t => (
            <g key={t}>
              <line className="grid" x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} />
              <text className="tick" x={M.left - 8} y={sy(t) + 4} textAnchor="end">{compact(t)}</text>
            </g>
          ))}
          {counts.map((count, i) => {
            const b = bar(i)
            return (
              <g key={i}>
                {count > 0 && (
                  <path d={topRoundedBar(b.x, b.top, barW, b.h)} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />
                )}
                {/* Hit target: the whole column band, focusable for keyboard readers. */}
                <rect
                  className="hit"
                  x={M.left + i * band}
                  y={M.top}
                  width={band}
                  height={height - M.top - M.bottom}
                  tabIndex={0}
                  aria-label={`${count} sets scored ${format(edges[i])} to ${format(edges[i + 1])}`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            )
          })}
          <line className="axis" x1={M.left} x2={width - M.right} y1={height - M.bottom} y2={height - M.bottom} />
          {xTicks.map((t, i) => (
            <text key={i} className="tick" x={sx(t)} y={height - M.bottom + 16} textAnchor={['start', 'middle', 'end'][i]}>
              {format(t)}
            </text>
          ))}
          <text className="axis-label" x={(M.left + width - M.right) / 2} y={height - 4} textAnchor="middle">{xLabel}</text>
          {cutoff !== undefined && cutoff >= lo && cutoff <= hi && (
            <g pointerEvents="none">
              <line className="cutoff" x1={sx(cutoff)} x2={sx(cutoff)} y1={M.top - 8} y2={height - M.bottom} />
              <text className="reference-label" x={sx(cutoff) - 5} y={M.top - 10} textAnchor="end">{cutoffLabel}</text>
            </g>
          )}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tooltip x={bar(hover).x + barW / 2} y={Math.max(bar(hover).top, M.top + 20)} width={width}>
          <div className="chart-tip__row">
            <strong>{counts[hover]} sets</strong>
            <span>scored {format(edges[hover])}–{format(edges[hover + 1])}</span>
          </div>
        </Tooltip>
      )}
    </div>
  )
}
