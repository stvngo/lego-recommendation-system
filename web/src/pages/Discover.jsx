import { useCallback, useEffect, useRef, useState } from 'react'
import PageHeader from '../components/PageHeader.jsx'
import SwipeCard from '../components/SwipeCard.jsx'
import { PicksPreview, TasteCard } from '../components/SideCards.jsx'
import { Check, Cross, Heart, Undo } from '../components/Icons.jsx'
import { useStore } from '../store.jsx'

const EXIT_MS = 280

export default function Discover() {
  const { deck, history, loading, rate, undo: undoRating } = useStore()
  const [exit, setExit] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef()

  const current = deck[0]

  const flash = useCallback((text, kind) => {
    clearTimeout(toastTimer.current)
    setToast({ text, kind, key: Date.now() })
    toastTimer.current = setTimeout(() => setToast(null), 1400)
  }, [])

  const decide = useCallback(dir => {
    if (!current || exit) return
    setExit({ id: current.id, dir })
    flash(dir > 0 ? 'Liked' : 'Passed', dir > 0 ? 'like' : 'pass')
    setTimeout(() => {
      rate(current.id, dir > 0 ? 1 : 0)
      setExit(null)
    }, EXIT_MS)
  }, [current, exit, rate, flash])

  const undo = useCallback(() => {
    if (!history.length || exit) return
    undoRating()
    flash('Undone', 'undo')
  }, [history.length, exit, undoRating, flash])

  useEffect(() => {
    const onKey = e => {
      if (e.target.closest('select, input, textarea')) return
      if (e.key === 'ArrowRight') decide(1)
      else if (e.key === 'ArrowLeft') decide(-1)
      else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [decide, undo])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  // Render the next card underneath so a swipe reveals it in place.
  const stack = deck.slice(0, 2).reverse()

  return (
    <div className="page">
      <PageHeader title="Discover." />

      <div className="discover-grid">
        <section className="discover-main">
          <div className="deck-labels">
            <span className="eyebrow"><i className="eyebrow__square" /> Next up</span>
            <span className="mono-muted">{loading ? 'Loading sets…' : `${deck.length} sets to explore`}</span>
          </div>

          <div className="deck">
            {stack.map(set => (
              <SwipeCard
                key={set.id}
                set={set}
                interactive={set === current}
                exitDir={exit?.id === set.id ? exit.dir : 0}
                onSwipe={decide}
              />
            ))}
            {!loading && !current && (
              <div className="deck-empty">
                <h2>You&apos;ve seen every set here.</h2>
                <p>Switch the build style to keep exploring, or check your picks.</p>
                <a className="btn btn--like" href="#/picks">See your picks</a>
              </div>
            )}
          </div>

          <div className="actions">
            <button className="icon-btn" onClick={undo} disabled={!history.length} aria-label="Undo last rating">
              <Undo width={18} height={18} />
            </button>
            <button className="btn btn--pass" onClick={() => decide(-1)} disabled={!current}>
              <Cross width={16} height={16} /> Pass
            </button>
            <button className="btn btn--like" onClick={() => decide(1)} disabled={!current}>
              <Heart width={16} height={16} /> Like
            </button>
          </div>
          <p className="hint">Swipe or use ← →</p>

          <div className="toast-slot" aria-live="polite">
            {toast && (
              <span key={toast.key} className={`toast toast--${toast.kind}`}>
                {toast.kind === 'undo' ? <Undo width={13} height={13} /> : toast.kind === 'like' ? <Check width={13} height={13} /> : <Cross width={13} height={13} />}
                {toast.text}
              </span>
            )}
          </div>
        </section>

        <aside className="discover-side">
          <TasteCard />
          <PicksPreview />
        </aside>
      </div>

      <footer className="credit">
        Catalog by{' '}
        <a href="https://rebrickable.com/downloads/" target="_blank" rel="noreferrer">Rebrickable ↗</a>
        {' '}· Independent of LEGO.
      </footer>
    </div>
  )
}
