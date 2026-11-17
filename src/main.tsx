import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { iniciarObservabilidad } from './lib/observabilidad'

// Antes de montar React: así también se capturan los errores del primer render.
iniciarObservabilidad()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
