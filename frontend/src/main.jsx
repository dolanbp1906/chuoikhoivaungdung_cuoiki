import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppBlockchain from './AppBlockchain.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppBlockchain />
  </StrictMode>,
)
