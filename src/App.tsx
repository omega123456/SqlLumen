import { useEffect } from 'react'
import { GlobalContextMenu } from './components/common/GlobalContextMenu'
import { AppLayout } from './components/layout/AppLayout'
import { useThemeStore } from './stores/theme-store'
import { useConnectionStore } from './stores/connection-store'
import { useSystemTheme } from './hooks/use-system-theme'

// react-data-grid base styles + Precision Studio custom theme
import 'react-data-grid/lib/styles.css'
import './styles/data-grid-precision.css'

function App() {
  const initialize = useThemeStore((state) => state.initialize)
  const setTheme = useThemeStore((state) => state.setTheme)
  const theme = useThemeStore((state) => state.theme)
  const setupEventListeners = useConnectionStore((state) => state.setupEventListeners)
  const systemTheme = useSystemTheme()

  useEffect(() => {
    void initialize()
    let cleanup: (() => void) | undefined
    setupEventListeners().then((unlisten) => {
      cleanup = unlisten
    })
    return () => {
      cleanup?.()
    }
  }, [initialize, setupEventListeners])

  // When system theme changes and user preference is 'system', re-apply
  useEffect(() => {
    if (theme === 'system') {
      void setTheme('system')
    }
  }, [systemTheme, theme, setTheme])

  return (
    <>
      <GlobalContextMenu />
      <AppLayout />
    </>
  )
}

export default App
