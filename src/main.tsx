import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import StripeStatsSection from './features/stripe-stats'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StripeStatsSection />
  </StrictMode>,
)
