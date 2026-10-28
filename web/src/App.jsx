import { useEffect, useState } from 'react'
import { useStore } from './store.jsx'
import Sidebar from './components/Sidebar.jsx'
import Discover from './pages/Discover.jsx'
import Picks from './pages/Picks.jsx'
import Insights from './pages/Insights.jsx'

const PAGES = { discover: Discover, picks: Picks, insights: Insights }

const readRoute = () => {
  const route = window.location.hash.replace(/^#\/?/, '')
  return route in PAGES ? route : 'discover'
}

export default function App() {
  const [route, setRoute] = useState(readRoute)
  const { error } = useStore()

  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const Page = PAGES[route]

  return (
    <div className="app">
      <Sidebar route={route} />
      <main className="main">
        {error && <div className="api-banner" role="alert">{error}</div>}
        <Page />
      </main>
    </div>
  )
}
