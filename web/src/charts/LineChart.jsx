import { useMemo, useState } from 'react'
import { linearScale, logScale } from './scale.js'
import { Legend, TipRow, Tooltip } from './parts.jsx'
import { useWidth } from './useWidth.js'

const M = { top: 14, bottom: 38, left: 40 }
const LABEL_GAP = 13 // px between end labels before they count as colliding

/**
 * Multi-series line chart with a snapping crosshair.
 * series: [{ key, label, color, points: [{ x, y, detail? }] }]
 * x: { type: 'linear' | 'log', domain, ticks, format, label }
 * y: { domain, ticks, format }
 * reference: optional { y, label } drawn as a muted hairline
 */
export default function LineChart({ series, x, y, reference, title, height = 240, endLabels = true }) {
  const [ref, width] = useWidth()
  const [hoverX, setHoverX] = useState(null)
  const right = endLabels ? 128 : 16

  const sx = useMemo(() => {
    const make = x.type === 'log' ? logScale : linearScale
    return make(x.domain, [M.left, Math.max(M.left + 1, width - right)])
  }, [x.type, x.domain, width, right])
  const sy = linearScale(y.domain, [height - M.bottom, M.top])

  const xs = useMemo(
    () => [...new Set(series.flatMap(s => s.points.map(p => p.x)))].sort((a, b) => a - b),
    [series],
  )

  // End labels ride the last point of each series, unless any two would collide;
  // then the legend + tooltip carry identity instead of stacked, detached labels.
  const ends = series
    .filter(s => s.points.length)
    .map(s => ({ ...s, last: s.points[s.points.length - 1] }))
    .map(s => ({ ...s, py: sy(s.last.y) }))
    .sort((a, b) => a.py - b.py)
  const labelsFit = endLabels && ends.every((s, i) => i === 0 || s.py - ends[i - 1].py >= LABEL_GAP)

  const onMove = e => {
    const mx = e.clientX - e.currentTarget.getBoundingClientRect().left
    let best = xs[0]
    for (const v of xs) if (Math.abs(sx(v) - mx) < Math.abs(sx(best) - mx)) best = v
    setHoverX(best)
  }

  const atHover = hoverX === null ? [] : series
    .map(s => ({ s, p: s.points.find(p => p.x === hoverX) }))
    .filter(r => r.p)
    .sort((a, b) => b.p.y - a.p.y)

  return (
    <>
      {series.length > 1 && <Legend items={series.map(s => ({ label: s.label, color: s.color, kind: 'line' }))} />}
      <div ref={ref} className="chart" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHoverX(null)}>
            {y.ticks.map(t => (
              <g key={t}>
                <line className="grid" x1={M.left} x2={width - right} y1={sy(t)} y2={sy(t)} />
                <text className="tick" x={M.left - 8} y={sy(t) + 4} textAnchor="end">{y.format(t)}</text>
              </g>
            ))}
            <line className="axis" x1={M.left} x2={width - right} y1={height - M.bottom} y2={height - M.bottom} />
            {x.ticks.map(t => (
              <text key={t} className="tick" x={sx(t)} y={height - M.bottom + 16} textAnchor="middle">{x.format(t)}</text>
            ))}
            <text className="axis-label" x={(M.left + width - right) / 2} y={height - 4} textAnchor="middle">{x.label}</text>

            {reference && (
              <g>
                <line className="reference" x1={M.left} x2={width - right} y1={sy(reference.y)} y2={sy(reference.y)} />
                <text className="reference-label" x={width - right - 6} y={sy(reference.y) - 6} textAnchor="end">
                  {reference.label}
                </text>
              </g>
            )}

            {series.map(s => (
              <path
                key={s.key}
                d={s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)},${sy(p.y)}`).join('')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {ends.map(s => (
              <g key={s.key}>
                <circle cx={sx(s.last.x)} cy={s.py} r={4} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />
                {labelsFit && (
                  <text className="end-label" x={sx(s.last.x) + 9} y={s.py + 4}>{s.label}</text>
                )}
              </g>
            ))}

            {hoverX !== null && (
              <g>
                <line className="crosshair" x1={sx(hoverX)} x2={sx(hoverX)} y1={M.top} y2={height - M.bottom} />
                {atHover.map(({ s, p }) => (
                  <circle key={s.key} cx={sx(p.x)} cy={sy(p.y)} r={4} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>
        )}
        {hoverX !== null && atHover.length > 0 && (
          <Tooltip x={sx(hoverX)} y={sy(atHover[0].p.y)} width={width}>
            <div className="chart-tip__title">{title(hoverX)}</div>
            {atHover.map(({ s, p }) => (
              <TipRow key={s.key} color={s.color} value={y.format(p.y, true)} label={p.detail ? `${s.label} ${p.detail}` : s.label} />
            ))}
          </Tooltip>
        )}
      </div>
    </>
  )
}
