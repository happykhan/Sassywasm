import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const saved = localStorage.getItem('gx-theme') ?? 'dark'
document.documentElement.setAttribute('data-theme', saved)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
