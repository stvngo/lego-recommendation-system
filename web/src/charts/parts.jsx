import { useState } from 'react'

// Shared chart chrome: tooltip, legend, table view, and the panel that hosts a chart.
// Labels come from API/catalog data; React renders them as text nodes, never HTML.

export function Tooltip({ x, y, width, children }) {
  const flip = x > width * 0.6
  return (
    <div
      className="chart-tip"
      style={{ left: x, top: y, transform: `translate(${flip ? 'calc(-100% - 14px)' : '14px'}, -50%)` }}
      role="status"
    >
      {children}
    </div>
  )
}

// Values lead, labels follow; series keyed with a short line, not a box.
export function TipRow({ color, value, label, kind = 'line' }) {
  return (
    <div className="chart-tip__row">
      <i className={`key key--${kind}`} style={{ background: color }} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

// A scatter mark: identity can ride on shape as well as color.
export function Marker({ x, y, r, shape = 'circle', fill, stroke = 'none' }) {
  const paint = { fill, stroke, strokeWidth: stroke === 'none' ? 0 : 1.5 }
  if (shape === 'square') {
    const s = r * 1.75
    return <rect x={x - s / 2} y={y - s / 2} width={s} height={s} {...paint} />
  }
  if (shape === 'triangle') {
    const h = r * 1.3
    return <path d={`M${x},${y - h}L${x + h},${y + h * 0.75}L${x - h},${y + h * 0.75}Z`} {...paint} />
  }
  if (shape === 'diamond') {
    const d = r * 1.3
    return <path d={`M${x},${y - d}L${x + d},${y}L${x},${y + d}L${x - d},${y}Z`} {...paint} />
  }
  return <circle cx={x} cy={y} r={r} {...paint} />
}

export function Legend({ items }) {
  return (
    <ul className="legend">
      {items.map(item => (
        <li key={item.label}>
          {item.kind === 'shape' ? (
            <svg className="key" width="12" height="12" aria-hidden="true">
              <Marker x={6} y={6} r={4} shape={item.shape} fill={item.color} />
            </svg>
          ) : (
            <i className={`key key--${item.kind ?? 'dot'}`} style={{ background: item.color }} />
          )}
          {item.label}
          {item.count !== undefined && <span className="legend__count">{item.count}</span>}
        </li>
      ))}
    </ul>
  )
}

export function DataTable({ columns, rows }) {
  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>{columns.map(c => <th key={c.key} className={c.numeric ? 'num' : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.key ?? i}>
              {columns.map(c => <td key={c.key} className={c.numeric ? 'num' : undefined}>{row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Toggle({ label, options, value, onChange }) {
  return (
    <div className="view-toggle" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const VIEWS = [{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]

// A titled card with a Chart / Table toggle. `empty` replaces both views with a message;
// `controls` adds header controls of its own; `loading` dims the body while it refreshes.
export function Panel({ title, note, className = '', table, empty, controls, loading, children }) {
  const [view, setView] = useState('chart')
  const showTable = view === 'table' && table && !empty

  return (
    <section className={`panel ${className}${loading ? ' is-loading' : ''}`}>
      <header className="panel__head">
        <div>
          <h3>{title}</h3>
          {note && <p>{note}</p>}
        </div>
        <div className="panel__controls">
          {controls}
          {table && !empty && <Toggle label={`${title} view`} options={VIEWS} value={view} onChange={setView} />}
        </div>
      </header>
      {empty ? (
        <div className="panel__empty"><span className="chip chip--outline">{empty}</span></div>
      ) : showTable ? (
        <DataTable {...table} />
      ) : (
        children
      )}
    </section>
  )
}
