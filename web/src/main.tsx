import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@fontsource-variable/bricolage-grotesque/wdth.css'
import '@fontsource-variable/instrument-sans'
import './styles.css'
import { ApiError } from './api.ts'
import { App } from './App.tsx'
import { applyTheme, storedTheme } from './theme.ts'
import { setupPwa } from './pwa.ts'
import { watchForUpdates } from './updates.ts'

applyTheme(storedTheme())
setupPwa()
watchForUpdates()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Offline and auth errors are handled by the app; retrying them only delays feedback.
      retry: (count, err) => !(err instanceof ApiError && (err.status === 0 || err.status === 401 || err.status === 404)) && count < 2,
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
