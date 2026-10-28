import PageHeader from '../components/PageHeader.jsx'
import { ArrowUpRight, Layers, Sparkle } from '../components/Icons.jsx'
import { useStore } from '../store.jsx'

const RANK_COLORS = ['blue', 'red', 'yellow', 'red', 'blue']

export default function Picks() {
  const { picks } = useStore()

  return (
    <div className="page">
      <PageHeader title="Your picks.">
        <span className="chip chip--yellow chip--lg">{picks.personalized ? 'Personalized' : 'Starter picks'}</span>
      </PageHeader>

      <span className="eyebrow"><Sparkle width={13} height={13} /> Top picks</span>

      {picks.loading && !picks.items.length ? (
        <p className="mono-muted picks-note">Loading picks…</p>
      ) : !picks.items.length ? (
        <p className="mono-muted picks-note">
          You&apos;ve rated every set in this build style. Switch styles for new picks.
        </p>
      ) : (
        <div className="picks-grid">
          {picks.items.map((set, i) => (
            <article key={set.id} className="pick-card">
              <span className={`rank rank--${RANK_COLORS[i % RANK_COLORS.length]}`}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="pick-card__stage">
                <img src={set.img} alt={set.name} draggable={false} />
              </div>
              <div className="pick-card__body">
                <span className="pick-card__theme">{set.theme}</span>
                <h2 className="pick-card__name">{set.name}</h2>
                <p className="pick-card__facts">
                  <Layers width={12} height={12} />
                  {set.parts.toLocaleString()} pieces <span className="dot-sep">·</span> {set.year}
                </p>
                <a className="pick-card__link" href={set.url} target="_blank" rel="noreferrer">
                  View set
                  <ArrowUpRight width={14} height={14} />
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
