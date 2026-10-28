import { BUILD_STYLES, useStore } from '../store.jsx'
import { BrickMark } from './Icons.jsx'

export default function PageHeader({ title, showBuildStyle = true, children }) {
  const { buildStyle, dispatch } = useStore()

  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {showBuildStyle && (
          <label className="build-style">
            <span>Build style</span>
            <select value={buildStyle} onChange={e => dispatch({ type: 'buildStyle', value: e.target.value })}>
              {BUILD_STYLES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="page-head__aside">
        <BrickMark size={112} />
        {children}
      </div>
    </header>
  )
}
