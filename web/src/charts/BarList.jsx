import { useState } from 'react'

/**
 * Horizontal bars for a ranked list, drawn in HTML so labels never clip.
 * Every bar carries its value at the tip, so hover only highlights the row.
 * rows: [{ key, label, value (0–1), valueLabel }]
 */
export default function BarList({ rows, color }) {
  const [hover, setHover] = useState(null)

  return (
    <ul className="bar-list" onPointerLeave={() => setHover(null)}>
      {rows.map(row => (
        <li
          key={row.key}
          className={hover && hover !== row.key ? 'is-dim' : undefined}
          onPointerEnter={() => setHover(row.key)}
        >
          <span className="bar-list__label">{row.label}</span>
          <span className="bar-list__track">
            <span className="bar-list__box">
              <span className="bar-list__bar" style={{ width: `${row.value * 100}%`, background: color }} />
            </span>
            <span className="bar-list__value">{row.valueLabel}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
