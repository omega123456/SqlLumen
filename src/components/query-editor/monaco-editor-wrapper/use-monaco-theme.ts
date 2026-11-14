import { useCallback, useEffect, useRef } from 'react'
import type { Monaco } from '@monaco-editor/react'
import { useThemeStore } from '../../../stores/theme-store'
import { registerMonacoThemes, getMonacoThemeName } from '../../../lib/monaco-theme'

export function useMonacoTheme(monaco: Monaco | null) {
  const themesRegistered = useRef(false)
  const theme = useThemeStore((state) => state.theme)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const currentThemeName = getMonacoThemeName(theme, resolvedTheme === 'dark')

  const ensureThemesRegistered = useCallback((monacoInstance: Monaco) => {
    if (themesRegistered.current) return
    registerMonacoThemes(monacoInstance)
    themesRegistered.current = true
  }, [])

  useEffect(() => {
    if (!monaco) return
    ensureThemesRegistered(monaco)
  }, [monaco, ensureThemesRegistered])

  useEffect(() => {
    if (!monaco) return
    if (!themesRegistered.current) return
    monaco.editor.setTheme(currentThemeName)
  }, [monaco, currentThemeName])

  const applyThemeOnMount = useCallback(
    (monacoInstance: Monaco) => {
      ensureThemesRegistered(monacoInstance)
      monacoInstance.editor.setTheme(currentThemeName)
    },
    [ensureThemesRegistered, currentThemeName]
  )

  return { currentThemeName, applyThemeOnMount }
}
