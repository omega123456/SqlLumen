import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { useThemeStore } from './stores/theme-store'
import { useSystemTheme } from './hooks/use-system-theme'

function App() {
  const initialize = useThemeStore((state) => state.initialize)
  const setTheme = useThemeStore((state) => state.setTheme)
  const theme = useThemeStore((state) => state.theme)
  const systemTheme = useSystemTheme()

  useEffect(() => {
    void initialize()
  }, [initialize])

  // When system theme changes and user preference is 'system', re-apply
  useEffect(() => {
    if (theme === 'system') {
      void setTheme('system')
    }
  }, [systemTheme, theme, setTheme])

  return <AppLayout />
}

export default App
