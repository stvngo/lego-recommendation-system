const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export const Heart = props => (
  <svg {...base} {...props}>
    <path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10z" />
  </svg>
)

export const Cross = props => (
  <svg {...base} {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const Undo = props => (
  <svg {...base} {...props}>
    <path d="M4 4v6h6" />
    <path d="M4.5 10A8 8 0 1 1 6 17" />
  </svg>
)

export const ArrowUpRight = props => (
  <svg {...base} {...props}>
    <path d="M7 17L17 7M8 7h9v9" />
  </svg>
)

export const Check = props => (
  <svg {...base} {...props}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
)

export const Compass = props => (
  <svg {...base} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5l-2 5-5 2 2-5z" />
  </svg>
)

export const BarChart = props => (
  <svg {...base} {...props}>
    <path d="M4 20h16M7 16v-4M12 16V8M17 16v-7" />
  </svg>
)

export const Sparkle = props => (
  <svg {...base} {...props}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M17.5 6.5L15 9M9 15l-2.5 2.5" />
  </svg>
)

export const Download = props => (
  <svg {...base} {...props}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
)

export const Layers = props => (
  <svg {...base} {...props}>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
)

// The three-brick mark in the top-right corner of each page.
export function BrickMark({ size = 120 }) {
  const brick = (x, y, w, color, shade, studs) => (
    <g>
      <rect x={x} y={y + 6} width={w} height={26} rx={4} fill={shade} stroke="#111" strokeWidth={2} />
      <rect x={x} y={y} width={w} height={24} rx={4} fill={color} stroke="#111" strokeWidth={2} />
      {Array.from({ length: studs }, (_, i) => (
        <g key={i}>
          <ellipse cx={x + 12 + i * ((w - 24) / Math.max(studs - 1, 1))} cy={y + 9} rx={6} ry={4} fill={shade} stroke="#111" strokeWidth={1.5} />
          <ellipse cx={x + 12 + i * ((w - 24) / Math.max(studs - 1, 1))} cy={y + 7} rx={6} ry={4} fill={color} stroke="#111" strokeWidth={1.5} />
        </g>
      ))}
    </g>
  )
  return (
    <svg width={size} height={size * 0.75} viewBox="0 0 160 120" aria-hidden="true">
      <g transform="rotate(-12 80 60)">{brick(58, 14, 62, '#2457e6', '#1638a8', 2)}</g>
      <g transform="rotate(-12 80 60)">{brick(18, 46, 62, '#e03127', '#a91d16', 2)}</g>
      <g transform="rotate(-12 80 60)">{brick(56, 58, 96, '#f6c915', '#c99a00', 4)}</g>
    </svg>
  )
}
