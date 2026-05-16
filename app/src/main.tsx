import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import './index.css'
import App from './App.tsx'

const saved = localStorage.getItem('gx-theme') ?? 'dark'
document.documentElement.setAttribute('data-theme', saved)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/Sassywasm">
      <Toaster position="bottom-right" />
      <App />
    </BrowserRouter>
  </StrictMode>,
)
