import { useEffect, useState } from 'react'
import './App.css'

type ServerStatus = 'checking' | 'online' | 'offline'

function App() {
  const [status, setStatus] = useState<ServerStatus>('checking')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`health check returned ${response.status}`)
        }
        const body: unknown = await response.json()
        if (
          typeof body !== 'object' ||
          body === null ||
          !('status' in body) ||
          body.status !== 'ok'
        ) {
          throw new Error('health check returned an invalid response')
        }
        setStatus('online')
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setStatus('offline')
        }
      })

    return () => controller.abort()
  }, [attempt])

  const statusText = {
    checking: 'Проверяем соединение',
    online: 'Go-сервер работает',
    offline: 'Сервер недоступен',
  }[status]

  return (
    <main>
      <p className="eyebrow">LOCAL RESEARCH RUNTIME</p>
      <h1>kotik-researcher</h1>
      <section className="status-card" aria-live="polite">
        <span className={`indicator indicator--${status}`} aria-hidden="true" />
        <div>
          <p className="status-label">Статус системы</p>
          <p className="status-value">{statusText}</p>
        </div>
        {status === 'offline' && (
          <button
            type="button"
            onClick={() => {
              setStatus('checking')
              setAttempt((value) => value + 1)
            }}
          >
            Повторить
          </button>
        )}
      </section>
      <p className="endpoint">GET /api/health</p>
    </main>
  )
}

export default App
