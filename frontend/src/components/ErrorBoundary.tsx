import { Component, type ErrorInfo, type ReactNode } from 'react'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  error: Error | null
}

/**
 * Catches render errors so one broken screen does not blank the whole app.
 *
 * React unmounts the entire tree when a render throws and nothing catches it,
 * which presents as a white page with no explanation — the user's only recourse
 * is a reload, and they have no idea why. That is precisely how a missing field
 * on the login response presented: the dashboard route threw, the app vanished,
 * and reloading "fixed" it. The underlying bug is fixed, but any future one
 * should surface as a readable message with a way out rather than a blank page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept as a console error rather than shipped anywhere: there is no error
    // reporting service in this build, and silently swallowing it would make
    // the cause much harder to find while developing.
    console.error('Unhandled render error:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state

    if (!error) return this.props.children

    return (
      <div className="page-shell">
        <section className="panel auth-panel" style={{ marginTop: '3rem' }}>
          <h2>Something went wrong on this screen</h2>
          <p className="muted-line">
            The rest of the app is still running. Going back to the start usually clears it.
          </p>
          <p className="error-msg">{error.message}</p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button
              className="primary-btn"
              type="button"
              onClick={() => {
                // Clearing the error re-renders the tree that failed; combined
                // with a route change this recovers without a full reload.
                this.setState({ error: null })
                window.location.assign('/')
              }}
            >
              Back to start
            </button>
            <button className="secondary-btn" type="button" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </div>
        </section>
      </div>
    )
  }
}
