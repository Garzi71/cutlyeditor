import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import * as store from './store'
import { player } from './engine/player'
import './styles.css'

// In development, expose the editor state for debugging from the DevTools console.
if (import.meta.env.DEV) Object.assign(window, { __cutly: { ...store, player } })

/** Shows a friendly message instead of a blank window if the UI crashes. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty" style={{ paddingTop: 120 }}>
        <h2 style={{ color: 'var(--text)' }}>Something went wrong</h2>
        <div className="err-box" style={{ maxWidth: 640, margin: '12px auto', textAlign: 'left' }}>
          {String(this.state.error.stack ?? this.state.error)}
        </div>
        <button className="btn primary" onClick={() => location.reload()}>
          Reload Cutly
        </button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
