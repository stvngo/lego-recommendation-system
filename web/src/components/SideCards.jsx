import { useStore } from '../store.jsx'
import { ArrowUpRight, Cross, Heart } from './Icons.jsx'

const GRID_SIZE = 25

export function TasteCard() {
  const { likes, passes } = useStore()

  return (
    <section className="taste-card">
      <header className="taste-card__head">
        <h3>Your taste</h3>
        <span className="taste-card__pulse" />
      </header>

      <div className="taste-card__counts">
        <div>
          <strong><Heart width={15} height={15} /> {likes}</strong>
          <span>likes</span>
        </div>
        <div>
          <strong><Cross width={14} height={14} /> {passes}</strong>
          <span>passes</span>
        </div>
      </div>

      <div className="brick-grid" aria-label={`${Math.min(likes, GRID_SIZE)} of ${GRID_SIZE} bricks filled`}>
        {Array.from({ length: GRID_SIZE }, (_, i) => (
          <span key={i} className={`brick${i < likes ? ' is-on' : ''}`} />
        ))}
      </div>

      <a className="taste-card__link" href="#/insights">
        Personalized
        <ArrowUpRight width={14} height={14} />
      </a>
    </section>
  )
}

export function PicksPreview() {
  const { picks } = useStore()
  const thumbs = picks.items.slice(0, 3)

  return (
    <a className="picks-preview" href="#/picks">
      <header>
        <h3>Your picks</h3>
        <ArrowUpRight width={15} height={15} />
      </header>
      <div className="picks-preview__thumbs">
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className="thumb">
            {thumbs[i] && <img src={thumbs[i].img} alt="" draggable={false} />}
          </span>
        ))}
      </div>
      <p>{picks.personalized ? `${picks.items.length} sets for you` : 'Like a few sets to personalize'}</p>
    </a>
  )
}
