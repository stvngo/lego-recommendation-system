import { useMemo, useState } from 'react'
import { linearScale } from './scale.js'
import { Legend, Marker, TipRow, Tooltip } from './parts.jsx'
import { useWidth } from './useWidth.js'

const PAD = 14
const HIT_RADIUS = 24
const COMPACT = 0.45 // a group gets a direct label if its mean spread is < this × the whole cloud's
const LABEL_HEIGHT = 14

/**
 * 2D map of the CLIP embeddings.
 * points: [{ id, x, y, group }]
 * groups: [{ key, label, color, shape, r, ring, labelOnMap }] in legend order
 * drawOrder: group keys, background first (later groups paint on top)
 * status: id -> { label, color }, the set's rating status, shown in the tooltip in every mode
 */
export default function ScatterMap({ points, groups, drawOrder, byId, status, height = 440 }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const groupOf = useMemo(() => new Map(groups.map(g => [g.key, g])), [groups])

  const placed = useMemo(() => {
    if (!width || !points.length) return []
    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)
    const sx = linearScale([Math.min(...xs), Math.max(...xs)], [PAD, width - PAD])
    const sy = linearScale([Math.min(...ys), Math.max(...ys)], [height - PAD, PAD])
    return points.map(p => ({ ...p, px: sx(p.x), py: sy(p.y) }))
  }, [points, width, height])

  const counts = useMemo(() => {
    const c = new Map()
    for (const p of points) c.set(p.group, (c.get(p.group) ?? 0) + 1)
    return c
  }, [points])

  // Direct labels on tight clusters; a label that would overlap one already placed
  // (bigger groups go first) is dropped, and the legend carries that group instead.
  const labels = useMemo(() => {
    if (!placed.length) return []
    const cx = placed.reduce((s, p) => s + p.px, 0) / placed.length
    const cy = placed.reduce((s, p) => s + p.py, 0) / placed.length
    const spread = placed.reduce((s, p) => s + Math.hypot(p.px - cx, p.py - cy), 0) / placed.length
    const median = values => {
      const v = [...values].sort((a, b) => a - b)
      return v[Math.floor(v.length / 2)]
    }
    const boxes = []
    const out = []
    for (const g of groups.filter(g => g.labelOnMap)) {
      const mine = placed.filter(p => p.group === g.key)
      if (mine.length < 5) continue
      const x = median(mine.map(p => p.px))
      const y = median(mine.map(p => p.py))
      const meanDist = mine.reduce((s, p) => s + Math.hypot(p.px - x, p.py - y), 0) / mine.length
      if (meanDist >= COMPACT * spread) continue
      const w = g.label.length * 6.6 + 8
      const box = { x0: x - w / 2, x1: x + w / 2, y0: y - LABEL_HEIGHT / 2, y1: y + LABEL_HEIGHT / 2 }
      const clash = boxes.some(b => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)
      const inside = box.x0 >= 0 && box.x1 <= width
      if (clash || !inside) continue
      boxes.push(box)
      out.push({ key: g.key, label: g.label, x, y })
    }
    return out
  }, [placed, groups, width])

  // Nearest point within HIT_RADIUS, so the pointer never has to land dead-center.
  const onMove = e => {
    const box = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - box.left
    const my = e.clientY - box.top
    let best = null
    let bestDist = HIT_RADIUS ** 2
    for (const p of placed) {
      const d = (p.px - mx) ** 2 + (p.py - my) ** 2
      if (d < bestDist) {
        best = p
        bestDist = d
      }
    }
    setHover(best)
  }

  const set = hover && byId.get(hover.id)
  const hoverGroup = hover && groupOf.get(hover.group)
  const hoverStatus = hover && status(hover.id)

  return (
    <>
      <Legend items={groups.map(g => ({ ...g, kind: 'shape', count: counts.get(g.key) ?? 0 }))} />
      <div ref={ref} className="chart" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {drawOrder.map(key => {
              const g = groupOf.get(key)
              return placed
                .filter(p => p.group === key)
                .map(p => (
                  <Marker
                    key={p.id}
                    x={p.px}
                    y={p.py}
                    r={g.r}
                    shape={g.shape}
                    fill={g.color}
                    stroke={g.ring ? 'var(--viz-surface)' : 'none'}
                  />
                ))
            })}
            {labels.map(l => (
              <text key={l.key} className="cluster-label" x={l.x} y={l.y + 4} textAnchor="middle">{l.label}</text>
            ))}
            {hover && <circle cx={hover.px} cy={hover.py} r={hoverGroup.r + 4} className="hover-ring" />}
          </svg>
        )}
        {hover && set && (
          <Tooltip x={hover.px} y={hover.py} width={width}>
            <div className="chart-tip__title">{set.name}</div>
            <div className="chart-tip__meta">{set.theme} · {set.year} · {set.parts.toLocaleString()} pcs</div>
            <TipRow color={hoverStatus.color} value={hoverStatus.label} kind="dot" />
          </Tooltip>
        )}
      </div>
    </>
  )
}
