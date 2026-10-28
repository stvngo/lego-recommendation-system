import { useState } from 'react'
import { ArrowUpRight, Layers } from './Icons.jsx'

const SWIPE_THRESHOLD = 110
const EXIT_DISTANCE = 1100

export default function SwipeCard({ set, interactive, exitDir, onSwipe }) {
  const [drag, setDrag] = useState(null)

  const dx = exitDir ? exitDir * EXIT_DISTANCE : drag?.dx ?? 0
  const progress = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1)

  const handlers = interactive && !exitDir ? {
    onPointerDown: e => {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setDrag({ startX: e.clientX, dx: 0 })
    },
    onPointerMove: e => {
      if (drag) setDrag({ ...drag, dx: e.clientX - drag.startX })
    },
    onPointerUp: () => {
      if (!drag) return
      setDrag(null)
      if (Math.abs(drag.dx) > SWIPE_THRESHOLD) onSwipe(Math.sign(drag.dx))
    },
    onPointerCancel: () => setDrag(null),
  } : {}

  return (
    <article
      className={`set-card${interactive ? ' is-top' : ''}${drag ? ' is-dragging' : ''}`}
      style={{
        transform: `translateX(${dx}px) rotate(${dx / 24}deg)`,
        opacity: exitDir ? 0 : 1,
      }}
      aria-hidden={!interactive}
      {...handlers}
    >
      <div className="set-card__band">
        <span className="chip chip--yellow">{set.theme}</span>
        <span className="set-card__num">No. {set.num}</span>
      </div>

      <div className="set-card__stage">
        <div className="set-card__ground" />
        <img src={set.img} alt={set.name} draggable={false} />
        <span className="stamp stamp--like" style={{ opacity: dx > 0 ? progress : 0 }}>Like</span>
        <span className="stamp stamp--pass" style={{ opacity: dx < 0 ? progress : 0 }}>Pass</span>
      </div>

      <div className="set-card__meta">
        <div>
          <h2 className="set-card__name">{set.name}</h2>
          <p className="set-card__facts">
            <Layers width={13} height={13} />
            {set.parts.toLocaleString()} pieces <span className="dot-sep">·</span> {set.year} release
          </p>
        </div>
        <a
          className="square-btn"
          href={set.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`View ${set.name} on Rebrickable`}
          onPointerDown={e => e.stopPropagation()}
          tabIndex={interactive ? 0 : -1}
        >
          <ArrowUpRight width={16} height={16} />
        </a>
      </div>
    </article>
  )
}
