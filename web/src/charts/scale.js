// Tiny scale / tick helpers for the hand-drawn SVG charts.

export function linearScale([d0, d1], [r0, r1]) {
  const span = d1 - d0 || 1
  return v => r0 + ((v - d0) / span) * (r1 - r0)
}

export function logScale([d0, d1], [r0, r1]) {
  const l0 = Math.log(d0)
  const span = Math.log(d1) - l0 || 1
  return v => r0 + ((Math.log(v) - l0) / span) * (r1 - r0)
}

// Round ticks at 1/2/5 × 10^k steps. The last tick is always >= max, so a
// chart that uses it as the top of its domain never clips its tallest mark.
export function niceTicks(min, max, count = 4) {
  if (!(max > min)) return [min]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw)
  const ticks = []
  for (let t = Math.ceil(min / step) * step; ; t += step) {
    ticks.push(+t.toFixed(10))
    if (t >= max - step * 1e-9) break
  }
  return ticks
}

export const compact = n => (Math.abs(n) >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(n))

// Column with a 4px rounded data-end, square at the baseline.
export function topRoundedBar(x, y, w, h, r = 4) {
  const rr = Math.max(0, Math.min(r, w / 2, h))
  return `M${x},${y + h}V${y + rr}A${rr},${rr} 0 0 1 ${x + rr},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + h}Z`
}
