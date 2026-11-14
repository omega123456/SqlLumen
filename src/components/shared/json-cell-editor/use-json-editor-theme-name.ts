import { useEffect, useState } from 'react'
import { getMonacoThemeName } from '../../../lib/monaco-theme'
import { currentTheme, observeThemeChange, type ThemeName } from '../../../lib/theme-tokens'
import { useThemeStore } from '../../../stores/theme-store'

export function useJsonEditorThemeName(): string {
  const [domTheme, setDomTheme] = useState<ThemeName>(() => currentTheme())
  const theme = useThemeStore((state) => state.theme)

  useEffect(() => {
    return observeThemeChange(() => setDomTheme(currentTheme()))
  }, [])

  const effectiveTheme = theme === 'system' ? theme : domTheme
  return getMonacoThemeName(effectiveTheme, domTheme === 'dark')
}
