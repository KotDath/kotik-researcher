import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import type { MockMode } from './mock-api'
import './styles.css'

// Быстрый режим агентской верификации и visual-тесты состояний: без preload
// (dev:renderer) или с явным ?mockApi=loading|demo|error ставим моковый api
// до первого рендера — App сразу дёргает window.api в useEffect.
const mockParam = new URLSearchParams(window.location.search).get('mockApi')
if (typeof window.api === 'undefined' || mockParam !== null) {
  const { installMockApi } = await import('./mock-api')
  const mode: MockMode = mockParam === 'loading' || mockParam === 'error' ? mockParam : 'demo'
  installMockApi(mode)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
