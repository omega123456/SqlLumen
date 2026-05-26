import { useEffect } from 'react'
import { GlobalContextMenu } from './components/common/GlobalContextMenu'
import { AppLayout } from './components/layout/AppLayout'
import { useThemeStore } from './stores/theme-store'
import { useConnectionStore } from './stores/connection-store'
import { useSessionRestoreStore } from './stores/session-restore-store'
import { useShortcutStore } from './stores/shortcut-store'
import { useZoomStore } from './stores/zoom-store'
import { useUpdateStore } from './stores/update-store'
import { useSystemTheme } from './hooks/use-system-theme'

// Glide Data Grid base styles + Precision Studio custom theme
import '@glideapps/glide-data-grid/dist/index.css'
import '@glideapps/glide-data-grid-cells/dist/index.css'
import './styles/data-grid-precision.css'

function App() {
  const initialize = useThemeStore((state) => state.initialize)
  const setTheme = useThemeStore((state) => state.setTheme)
  const theme = useThemeStore((state) => state.theme)
  const setupEventListeners = useConnectionStore((state) => state.setupEventListeners)
  const restoreSession = useSessionRestoreStore((state) => state.restoreSession)
  const initializeShortcuts = useShortcutStore((state) => state.initializeFromBackend)
  const systemTheme = useSystemTheme()

  useEffect(() => {
    void initialize()
    void initializeShortcuts()
    void useZoomStore.getState().initialize()
    let cleanup: (() => void) | undefined
    setupEventListeners().then((unlisten) => {
      cleanup = unlisten
    })
    void restoreSession()
    void useUpdateStore.getState().startPeriodicCheck()
    return () => {
      cleanup?.()
      useUpdateStore.getState().stopPeriodicCheck()
    }
  }, [initialize, initializeShortcuts, setupEventListeners, restoreSession])

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
