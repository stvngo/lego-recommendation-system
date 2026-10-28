import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { api } from './api.js'

// Before the API existed, ratings lived here too; they're uploaded once on first
// connect. Now only the build style is kept locally.
const STORAGE_KEY = 'studio:v1'
const initialState = { buildStyle: 'display', ratings: {}, history: [] }
const EMPTY_PICKS = { items: [], personalized: false, model: 'none', n_ratings: 0, loading: true }

export const BUILD_STYLES = [
  { value: 'display', label: 'Display builds' },
  { value: 'play', label: 'Play sets' },
  { value: 'all', label: 'All builds' },
]

function loadState() {
  try {
    return { ...initialState, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) }
  } catch {
    return initialState
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'rate':
      return {
        ...state,
        ratings: { ...state.ratings, [action.id]: action.value },
        history: [...state.history.filter(id => id !== action.id), action.id],
      }
    case 'undo': {
      if (!state.history.length) return state
      const id = state.history[state.history.length - 1]
      const { [id]: _, ...ratings } = state.ratings
      return { ...state, ratings, history: state.history.slice(0, -1) }
    }
    case 'hydrate':
      return { ...state, ratings: action.ratings, history: action.history }
    case 'buildStyle':
      return { ...state, buildStyle: action.value }
    default:
      return state
  }
}

// Stable pseudo-shuffle so the deck order doesn't jump around between reloads.
function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return h >>> 0
}

const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const [catalog, setCatalog] = useState(null)
  const [synced, setSynced] = useState(false)
  const [error, setError] = useState(null)
  const [picks, setPicks] = useState(EMPTY_PICKS)
  const [serverVersion, setServerVersion] = useState(0)
  const writes = useRef(Promise.resolve())
  const picksRequest = useRef(0)

  // Initial load: catalog + this browser's ratings from the server.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [sets, server] = await Promise.all([api.sets(), api.ratings()])
        let current = server
        const local = loadState()
        if (!server.history.length && local.history.length) {
          await api.importRatings(local.ratings, local.history)
          current = await api.ratings()
        }
        if (cancelled) return
        setCatalog([...sets].sort((a, b) => hash(a.id) - hash(b.id)))
        dispatch({ type: 'hydrate', ratings: current.ratings, history: current.history })
        setSynced(true)
      } catch {
        if (!cancelled) setError("Can't reach the API. Start it with: uvicorn api.main:app --port 8000")
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Persist only the build style; ratings live on the server. Waiting for the
  // first sync keeps pre-API ratings in storage until they've been uploaded.
  useEffect(() => {
    if (!synced) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ buildStyle: state.buildStyle }))
    } catch {
      // Storage can be unavailable (private mode); the style just won't persist.
    }
  }, [synced, state.buildStyle])

  // Writes run one at a time so the server sees ratings in the same order as the
  // UI (undo removes the server's newest rating). The UI updates immediately; if
  // a write fails, re-fetch the server's ratings so the two can't drift apart.
  const write = useCallback(send => {
    writes.current = writes.current
      .then(send)
      .then(() => {
        setError(null)
        setServerVersion(v => v + 1)
      })
      .catch(async () => {
        setError('Lost connection to the API; your last rating may not have saved.')
        try {
          const server = await api.ratings()
          dispatch({ type: 'hydrate', ratings: server.ratings, history: server.history })
        } catch { /* still offline */ }
      })
  }, [])

  const rate = useCallback((id, value) => {
    dispatch({ type: 'rate', id, value })
    write(() => api.rate(id, value))
  }, [write])

  const undo = useCallback(() => {
    dispatch({ type: 'undo' })
    write(() => api.undo())
  }, [write])

  // Refresh picks after every saved write and whenever the build style changes.
  // The counter drops responses that arrive after a newer request was sent.
  useEffect(() => {
    if (!synced) return
    const requestId = ++picksRequest.current
    setPicks(p => ({ ...p, loading: true }))
    api.recommendations(state.buildStyle)
      .then(result => {
        if (requestId === picksRequest.current) setPicks({ ...result, loading: false })
      })
      .catch(() => {
        if (requestId === picksRequest.current) setPicks(p => ({ ...p, loading: false }))
      })
  }, [synced, state.buildStyle, serverVersion])

  const value = useMemo(() => {
    const sets = catalog ?? []
    const pool = state.buildStyle === 'all' ? sets : sets.filter(s => s.style === state.buildStyle)
    const deck = pool.filter(s => !(s.id in state.ratings))
    const values = Object.values(state.ratings)
    const likes = values.filter(v => v === 1).length

    return {
      ...state,
      dispatch,
      rate,
      undo,
      error,
      loading: catalog === null,
      catalog: sets,
      pool,
      deck,
      likes,
      passes: values.length - likes,
      picks,
      // Views that fetch derived data wait for `synced` (the first load, including the
      // one-time import of pre-API ratings) and refetch when `serverVersion` bumps
      // after every saved write.
      synced,
      serverVersion,
    }
  }, [catalog, state, rate, undo, error, picks, synced, serverVersion])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export const useStore = () => useContext(StoreContext)
