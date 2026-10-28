import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import BarList from '../charts/BarList.jsx'
import Histogram from '../charts/Histogram.jsx'
import LineChart from '../charts/LineChart.jsx'
import ScatterMap from '../charts/ScatterMap.jsx'
import { Panel, Toggle } from '../charts/parts.jsx'
import { niceTicks } from '../charts/scale.js'
import PageHeader from '../components/PageHeader.jsx'
import { Download } from '../components/Icons.jsx'
import { useStore } from '../store.jsx'

const MODELS = {
  lr: { value: 'LR', note: 'logistic regression' },
  baseline: { value: 'Similarity', note: 'until 5 likes + 5 passes' },
  none: { value: '—', note: 'like a set to start' },
}

// Learning-curve series in fixed slot order; each picks its column from an ml.evaluate result.
const EVAL_SERIES = [
  { key: 'lr', label: 'Logistic regression', color: 'var(--viz-1)', find: names => names.find(n => n === 'lr C=1') ?? names.find(n => n.startsWith('lr')) },
  { key: 'centered', label: 'Similarity, centered', color: 'var(--viz-2)', find: names => names.find(n => n === 'baseline centered') },
  { key: 'raw', label: 'Similarity, raw', color: 'var(--viz-3)', find: names => names.find(n => n === 'baseline') },
]
const MIN_THEME_RATINGS = 3
const MAX_THEMES = 12

const EVAL_SOURCES = [{ value: 'online', label: 'Live' }, { value: 'offline', label: 'Offline' }]

// Embedding map: rating status mode.
const STATUS = {
  liked: { label: 'Liked', color: 'var(--viz-like)', shape: 'circle', r: 4, ring: true },
  passed: { label: 'Passed', color: 'var(--viz-pass)', shape: 'circle', r: 4, ring: true },
  pick: { label: 'Your picks', color: 'var(--viz-pick)', shape: 'circle', r: 6, ring: true },
  unrated: { label: 'Not rated', color: 'var(--viz-context)', shape: 'circle', r: 2.5, ring: false },
}
const STATUS_GROUPS = ['liked', 'passed', 'pick', 'unrated'].map(key => ({ key, ...STATUS[key] }))
const STATUS_DRAW_ORDER = ['unrated', 'passed', 'liked', 'pick'] // picks paint on top

// Embedding map: theme mode. Three hues that stay apart in a scatter × four shapes =
// 12 themes; two themes that share a hue always differ in shape.
const THEME_HUES = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)']
const THEME_SHAPES = ['circle', 'square', 'triangle', 'diamond']
const MAX_MAP_THEMES = THEME_HUES.length * THEME_SHAPES.length
const OTHER = '__other'

const PROJECTIONS = [{ value: 'pca', label: 'PCA' }, { value: 'tsne', label: 't-SNE' }]
const MAP_COLORS = [{ value: 'status', label: 'Ratings' }, { value: 'theme', label: 'Themes' }]

const two = v => v.toFixed(2)
const pct = v => `${Math.round(v * 100)}%`

// One ml.evaluate result (live or offline, same shape) -> chart-ready learning curves.
function learningCurves(result) {
  if (!result) return null
  const names = Object.keys(result.models)
  const series = EVAL_SERIES
    .map(s => ({ ...s, name: s.find(names) }))
    .filter(s => s.name)
    .map(({ key, label, color, name }) => ({
      key,
      label,
      color,
      points: Object.entries(result.models[name])
        .map(([n, r]) => ({ x: Number(n), y: r.p_mean, std: r.p_std, detail: `± ${two(r.p_std)}` }))
        .sort((a, b) => a.x - b.x),
    }))
    .filter(s => s.points.length)
  if (!series.length) return null

  const lr = series.find(s => s.key === 'lr')
  const xs = series.flatMap(s => s.points.map(p => p.x))
  const max = Math.max(...xs)
  const domain = [0, max]
  const ticks = niceTicks(0, max, 4).filter(t => t <= max)
  return { result, series, domain, ticks, best: lr?.points[lr.points.length - 1] }
}

// Same {set_id: 1|0} shape that `python -m ml.evaluate --ratings` reads.
function downloadRatings(ratings) {
  const blob = new Blob([JSON.stringify(ratings, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: 'my_ratings.json' })
  link.click()
  URL.revokeObjectURL(url)
}

export default function Insights() {
  const { likes, passes, ratings, history, picks, catalog, pool, buildStyle, synced, serverVersion } = useStore()
  const [data, setData] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [evalData, setEvalData] = useState(null)
  const [evalLoading, setEvalLoading] = useState(false)
  const [evalSource, setEvalSource] = useState('online')
  const [projection, setProjection] = useState('pca')
  const [mapColor, setMapColor] = useState('status')
  const total = likes + passes

  // Refetch on every saved rating and style change; the previous render stays up meanwhile.
  // Waits for the first sync so a fresh browser's imported ratings are already on the server.
  useEffect(() => {
    if (!synced) return
    let live = true
    setRefreshing(true)
    api.insights(buildStyle)
      .then(d => { if (live) { setData(d); setFailed(false) } })
      .catch(() => { if (live) setFailed(true) })
      .finally(() => { if (live) setRefreshing(false) })
    return () => { live = false }
  }, [synced, buildStyle, serverVersion])

  // The live evaluation takes up to a second, so it loads separately from the other charts.
  // It covers all of the user's ratings, so it doesn't depend on the build style.
  useEffect(() => {
    if (!synced) return
    let live = true
    setEvalLoading(true)
    api.evaluation()
      .then(d => { if (live) setEvalData(d) })
      .catch(() => {})
      .finally(() => { if (live) setEvalLoading(false) })
    return () => { live = false }
  }, [synced, serverVersion])

  const byId = useMemo(() => new Map(catalog.map(s => [s.id, s])), [catalog])

  const hasTsne = !!data?.points.length && data.points.every(p => p.tsne)

  // Points, groups and draw order for the embedding map in the chosen layout and coloring.
  const map = useMemo(() => {
    if (!data) return null
    const layout = projection === 'tsne' && hasTsne ? 'tsne' : 'pca'
    const at = p => ({ id: p.id, x: p[layout][0], y: p[layout][1] })

    if (mapColor === 'status') {
      return {
        points: data.points.map(p => ({ ...at(p), group: p.status })),
        groups: STATUS_GROUPS,
        drawOrder: STATUS_DRAW_ORDER,
      }
    }

    // Largest themes in the current build style get a hue × shape; the rest fold into Other.
    const counts = new Map()
    for (const p of data.points) {
      const theme = byId.get(p.id)?.theme
      counts.set(theme, (counts.get(theme) ?? 0) + 1)
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, MAX_MAP_THEMES).map(([theme]) => theme)
    const isTop = new Set(top)
    const otherThemes = counts.size - top.length
    const groups = top.map((theme, i) => ({
      key: theme,
      label: theme,
      color: THEME_HUES[i % THEME_HUES.length],
      shape: THEME_SHAPES[Math.floor(i / THEME_HUES.length)],
      r: 4,
      ring: true,
      labelOnMap: true,
    }))
    if (otherThemes > 0) {
      groups.push({ key: OTHER, label: `Other (${otherThemes} themes)`, color: 'var(--viz-context)', shape: 'circle', r: 2.5, ring: false })
    }
    return {
      points: data.points.map(p => {
        const theme = byId.get(p.id)?.theme
        return { ...at(p), group: isTop.has(theme) ? theme : OTHER }
      }),
      groups,
      // Other in the background, then the largest themes first so smaller ones aren't buried.
      drawOrder: [...(otherThemes > 0 ? [OTHER] : []), ...top],
    }
  }, [data, projection, mapColor, hasTsne, byId])

  const statusOf = useMemo(() => {
    const byPoint = new Map(data?.points.map(p => [p.id, p.status]))
    return id => STATUS[byPoint.get(id)] ?? STATUS.unrated
  }, [data])

  // Ratings within the current build style, oldest first.
  const timeline = useMemo(() => {
    const inPool = new Set(pool.map(s => s.id))
    let liked = 0
    let passed = 0
    return history.filter(id => inPool.has(id)).map((id, i) => {
      if (ratings[id]) liked++
      else passed++
      return { n: i + 1, id, value: ratings[id], liked, passed }
    })
  }, [history, ratings, pool])

  const themes = useMemo(() => {
    const byTheme = new Map()
    for (const s of pool) {
      if (!(s.id in ratings)) continue
      const t = byTheme.get(s.theme) ?? { theme: s.theme, liked: 0, rated: 0 }
      t.rated++
      t.liked += ratings[s.id]
      byTheme.set(s.theme, t)
    }
    return [...byTheme.values()]
      .filter(t => t.rated >= MIN_THEME_RATINGS)
      .map(t => ({ ...t, rate: t.liked / t.rated }))
      .sort((a, b) => b.rate - a.rate || b.rated - a.rated)
      .slice(0, MAX_THEMES)
  }, [pool, ratings])

  const online = useMemo(() => learningCurves(evalData?.online), [evalData])
  const offline = useMemo(() => learningCurves(evalData?.offline), [evalData])
  const evaluation = evalSource === 'offline' && offline ? offline : online
  // The stat tile only shows the viewer's own (live) number; the offline file may be someone else's.
  const headline = online

  const scored = picks.items.filter(item => item.score !== null && item.score !== undefined)
  const cutoff = picks.personalized && scored.length ? Math.min(...scored.map(item => item.score)) : undefined
  const scoreLabel = data?.model === 'lr' ? 'predicted P(like)' : 'similarity to your likes'

  const stats = [
    { label: 'Ratings', value: total },
    { label: 'Likes', value: likes },
    { label: 'Passes', value: passes },
    { label: 'Like rate', value: total ? pct(likes / total) : '—' },
    {
      label: 'Precision@5',
      value: headline?.best ? two(headline.best.y) : '—',
      note: headline?.best ? `live, trained on ${headline.best.x}` : 'needs 5 likes + 5 passes',
    },
    { label: 'Model', ...(MODELS[picks.model] ?? { value: picks.model }) },
  ]

  const loadingMessage = failed ? 'API unavailable' : 'Loading…'

  return (
    <div className="page">
      <PageHeader title="Model insights.">
        <button className="btn btn--sm" onClick={() => downloadRatings(ratings)} disabled={!total}>
          <Download width={14} height={14} /> Export ratings
        </button>
      </PageHeader>

      <div className="stat-row">
        {stats.map(s => (
          <div key={s.label} className="stat">
            <span className="stat__label">{s.label}</span>
            <span className="stat__value">{s.value}</span>
            {s.note && <span className="stat__note">{s.note}</span>}
          </div>
        ))}
      </div>

      <div className={`insights-grid${refreshing && data ? ' is-refreshing' : ''}`}>
        <Panel
          className="panel--wide panel--tall"
          title="Embedding map"
          note={
            projection === 'tsne' && hasTsne
              ? 'Each dot is a set; nearby dots look alike to CLIP. t-SNE keeps neighbors together, but gaps between clusters and cluster sizes don\'t mean anything.'
              : 'Each dot is a set; nearby dots look alike to CLIP. Axes are the first two principal components and have no units.'
          }
          controls={data && (
            <>
              {hasTsne && <Toggle label="Map layout" options={PROJECTIONS} value={projection} onChange={setProjection} />}
              <Toggle label="Map coloring" options={MAP_COLORS} value={mapColor} onChange={setMapColor} />
            </>
          )}
          empty={!data ? loadingMessage : !data.points.length && 'No sets in this style'}
          table={data && {
            columns: [{ key: 'name', label: 'Set' }, { key: 'theme', label: 'Theme' }, { key: 'status', label: 'Status' }],
            rows: data.points
              .filter(p => p.status !== 'unrated')
              .sort((a, b) => ['pick', 'liked', 'passed'].indexOf(a.status) - ['pick', 'liked', 'passed'].indexOf(b.status))
              .map(p => ({ key: p.id, name: byId.get(p.id)?.name, theme: byId.get(p.id)?.theme, status: STATUS[p.status].label })),
          }}
        >
          {map && (
            <ScatterMap points={map.points} groups={map.groups} drawOrder={map.drawOrder} byId={byId} status={statusOf} />
          )}
        </Panel>

        <Panel
          title="Likes vs passes"
          note="Running totals, in the order you rated."
          empty={timeline.length < 2 && 'Rate a few sets to see this'}
          table={{
            columns: [
              { key: 'n', label: '#', numeric: true },
              { key: 'name', label: 'Set' },
              { key: 'rating', label: 'Rating' },
              { key: 'liked', label: 'Likes', numeric: true },
              { key: 'passed', label: 'Passes', numeric: true },
            ],
            rows: timeline.map(t => ({ ...t, key: t.id, name: byId.get(t.id)?.name, rating: t.value ? 'Like' : 'Pass' })),
          }}
        >
          <LineChart
            height={210}
            series={[
              { key: 'liked', label: 'Likes', color: 'var(--viz-like)', points: timeline.map(t => ({ x: t.n, y: t.liked })) },
              { key: 'passed', label: 'Passes', color: 'var(--viz-pass)', points: timeline.map(t => ({ x: t.n, y: t.passed })) },
            ]}
            x={{ type: 'linear', domain: [1, Math.max(timeline.length, 2)], ticks: niceTicks(0, timeline.length, 3).filter(t => t >= 1), format: String, label: 'ratings so far' }}
            y={(() => {
              const ticks = niceTicks(0, Math.max(likes, passes, 1), 3)
              return { domain: [0, ticks[ticks.length - 1]], ticks, format: String }
            })()}
            title={n => `After ${n} ratings`}
          />
        </Panel>

        <Panel
          title="Score distribution"
          note={`What the model thinks of every unrated set (${scoreLabel}).`}
          empty={
            !data ? loadingMessage
              : !data.score_histogram ? (data.model === 'none' ? 'Like a set to get scores' : 'No unrated sets in this style')
                : null
          }
          table={data?.score_histogram && {
            columns: [{ key: 'range', label: 'Score' }, { key: 'count', label: 'Sets', numeric: true }],
            rows: data.score_histogram.counts.map((count, i) => ({
              range: `${two(data.score_histogram.edges[i])}–${two(data.score_histogram.edges[i + 1])}`,
              count,
            })),
          }}
        >
          {data?.score_histogram && (
            <Histogram
              bins={data.score_histogram}
              color="var(--viz-1)"
              cutoff={cutoff}
              cutoffLabel="your top 5 →"
              format={two}
              xLabel={scoreLabel}
            />
          )}
        </Panel>

        <Panel
          className="panel--wide"
          title="Precision@5 vs ratings"
          note={
            evaluation === offline && offline
              ? `Offline run of python -m ml.evaluate on "${offline.result.name}" (${offline.result.n_ratings} ratings). Higher is better.`
              : online
                ? `Live, on all ${online.result.n_ratings} of your ratings: mean of ${online.result.n_splits} random train/test splits, updated as you rate. Higher is better.`
                : 'Live evaluation on your ratings. Higher is better.'
          }
          controls={offline && (
            <Toggle label="Evaluation source" options={EVAL_SOURCES} value={evalSource} onChange={setEvalSource} />
          )}
          loading={evalLoading && !!evalData}
          empty={
            !evalData ? (evalLoading ? 'Loading…' : 'API unavailable')
              : !evaluation && `Live evaluation ${evalData.online_note}`
          }
          table={evaluation && {
            columns: [
              { key: 'n', label: 'Training ratings', numeric: true },
              ...evaluation.series.map(s => ({ key: s.key, label: s.label, numeric: true })),
            ],
            rows: evaluation.series[0].points.map(p => ({
              key: p.x,
              n: p.x,
              ...Object.fromEntries(evaluation.series.map(s => {
                const q = s.points.find(r => r.x === p.x)
                return [s.key, q ? `${two(q.y)} ± ${two(q.std)}` : '—']
              })),
            })),
          }}
        >
          {evaluation && (
            <LineChart
              height={250}
              series={evaluation.series}
              x={{
                type: 'linear',
                domain: evaluation.domain,
                ticks: evaluation.ticks,
                format: String,
                label: 'ratings used for training',
              }}
              y={{ domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1], format: two }}
              reference={{ y: evaluation.result.base_rate, label: `random ${two(evaluation.result.base_rate)}` }}
              title={n => `Trained on ${n} ratings`}
            />
          )}
        </Panel>

        <Panel
          title="Like rate by theme"
          note={`Themes with at least ${MIN_THEME_RATINGS} ratings in this style.`}
          empty={!themes.length && `Rate ${MIN_THEME_RATINGS}+ sets in a theme to see this`}
          table={{
            columns: [
              { key: 'theme', label: 'Theme' },
              { key: 'liked', label: 'Liked', numeric: true },
              { key: 'rated', label: 'Rated', numeric: true },
              { key: 'rateLabel', label: 'Like rate', numeric: true },
            ],
            rows: themes.map(t => ({ ...t, key: t.theme, rateLabel: pct(t.rate) })),
          }}
        >
          <BarList
            color="var(--viz-like)"
            rows={themes.map(t => ({ key: t.theme, label: t.theme, value: t.rate, valueLabel: `${pct(t.rate)} · ${t.liked}/${t.rated}` }))}
          />
        </Panel>
      </div>
    </div>
  )
}
