import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@genomicx/ui/styles/tokens.css'
import '@genomicx/ui/styles/components.css'
import './index.css'
import App from './App.tsx'

const saved = localStorage.getItem('gx-theme') ?? 'dark'
document.documentElement.setAttribute('data-theme', saved)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
