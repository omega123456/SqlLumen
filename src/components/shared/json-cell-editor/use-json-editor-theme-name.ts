import { useEffect, useState } from 'react'
import { getMonacoThemeName } from '../../../lib/monaco-theme'
import { useThemeStore } from '../../../stores/theme-store'
import { getCurrentDomTheme } from './json-cell-editor-values'

export function useJsonEditorThemeName(): string {
  const [domTheme, setDomTheme] = useState<'light' | 'dark'>(() => getCurrentDomTheme())
  const theme = useThemeStore((state) => state.theme)

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDomTheme(getCurrentDomTheme())
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    return () => observer.disconnect()
  }, [])

  const effectiveTheme = theme === 'system' ? theme : domTheme
  return getMonacoThemeName(effectiveTheme, domTheme === 'dark')
}
