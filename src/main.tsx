import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/instrument-sans/index.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import App from './App'
import {
  applyInProgressTheme,
  connectInProgress,
  isEmbeddedFrame,
  loadInProgressProject,
  type InProgressHostClient,
} from './lib/inProgressHost'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

function render(content: ReactNode): void {
  root.render(<StrictMode>{content}</StrictMode>)
}

async function start(): Promise<void> {
  if (!isEmbeddedFrame()) {
    render(<App />)
    return
  }

  render(
    <main className="embedded-bootstrap" role="status">
      <span className="embedded-bootstrap-mark" aria-hidden="true">→</span>
      <p>Connecting to in-progress…</p>
    </main>,
  )

  let host: InProgressHostClient | undefined
  try {
    host = await connectInProgress()
    const activeHost = host
    applyInProgressTheme(activeHost.context.theme)
    const project = await loadInProgressProject(activeHost)
    window.addEventListener('pagehide', () => activeHost.dispose(), { once: true })
    render(<App embeddedProject={project} />)
  } catch (error) {
    host?.dispose()
    const message = error instanceof Error ? error.message : 'Embedded startup failed'
    render(
      <main className="embedded-bootstrap embedded-bootstrap-error" role="alert">
        <span className="embedded-bootstrap-mark" aria-hidden="true">!</span>
        <h1>Turbo Prompt is unavailable</h1>
        <p>{message}</p>
      </main>,
    )
  }
}

void start()
