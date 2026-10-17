import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useStore } from './store'
import './styles.css'

declare global { interface Window { __obrub: typeof useStore } }
window.__obrub = useStore // handle for the e2e smoke test

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
