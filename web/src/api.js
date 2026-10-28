// Client for the FastAPI backend (api/main.py). In dev, Vite proxies /api to
// http://localhost:8000 (see vite.config.js), so requests stay same-origin.

const UID_KEY = 'studio:uid'

// Anonymous per-browser id, sent as X-User-Id on every request.
let uid = null
function userId() {
  if (uid) return uid
  try { uid = localStorage.getItem(UID_KEY) } catch { /* storage unavailable */ }
  if (!uid) {
    uid = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    try { localStorage.setItem(UID_KEY, uid) } catch { /* id just won't survive a reload */ }
  }
  return uid
}

export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === 'string' ? detail : `API request failed (${status})`)
    this.status = status
  }
}

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'X-User-Id': userId(),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.json().then(d => d.detail, () => null)
    throw new ApiError(res.status, detail)
  }
  return res.json()
}

export const api = {
  sets: () => request('GET', '/sets?style=all'),
  ratings: () => request('GET', '/ratings'),
  rate: (setId, value) => request('POST', '/ratings', { set_id: setId, value }),
  importRatings: (ratings, history) => request('POST', '/ratings/import', { ratings, history }),
  undo: () => request('DELETE', '/ratings/last'),
  recommendations: (style, k = 5) => request('GET', `/recommendations?style=${style}&k=${k}`),
  insights: style => request('GET', `/insights?style=${style}`),
  evaluation: () => request('GET', '/evaluation'),
}
