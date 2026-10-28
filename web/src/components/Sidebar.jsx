import { useStore } from '../store.jsx'
import { BarChart, Compass, Heart } from './Icons.jsx'

const NAV = [
  { route: 'discover', label: 'Discover', Icon: Compass },
  { route: 'picks', label: 'Recommendations', Icon: Heart },
  { route: 'insights', label: 'Model Insights', Icon: BarChart },
]

export default function Sidebar({ route }) {
  const { history } = useStore()

  return (
    <aside className="sidebar">
      <a className="sidebar__logo" href="#/discover">
        <span className="logo-brick" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
        stud.io
      </a>

      <nav className="sidebar__nav">
        {NAV.map(({ route: r, label, Icon }) => (
          <a
            key={r}
            href={`#/${r}`}
            className={`nav-item${route === r ? ' is-active' : ''}`}
            aria-current={route === r ? 'page' : undefined}
          >
            <Icon width={15} height={15} />
            {label}
            {route === r && <span className="nav-item__dot" />}
          </a>
        ))}
      </nav>

      <div className="sidebar__footer">
        <span className="sidebar__avatar">Y</span>
        <div>
          <div className="sidebar__space">Your build space</div>
          <div className="sidebar__meta">{history.length} sets rated</div>
        </div>
      </div>
    </aside>
  )
}
