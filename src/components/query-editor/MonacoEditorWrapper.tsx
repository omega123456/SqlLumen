/**
 * Monaco Editor React wrapper with MySQL syntax highlighting,
 * theme switching, query store integration, and autocomplete.
 */

import { useEffect, useRef } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import type * as MonacoType from 'monaco-editor'
import { useThemeStore } from '../../stores/theme-store'
import { useQueryStore } from '../../stores/query-store'
import { registerMonacoThemes, getMonacoThemeName } from './monaco-theme'
import { registerModelConnection, unregisterModelConnection } from './completion-service'
import { loadCache } from './schema-metadata-cache'
import styles from './MonacoEditorWrapper.module.css'

// Register the 'mysql' language with Monaco (side-effect import)
import 'monaco-sql-languages/esm/languages/mysql/mysql.contribution'

// Setup language features with our custom completionService (side-effect import)
import './mysql-language-setup'

interface MonacoEditorWrapperProps {
  tabId: string
  /** Connection ID for schema-aware autocomplete */
  connectionId?: string
  /** Called with the Monaco editor instance after mount */
  onMount?: (editor: MonacoType.editor.IStandaloneCodeEditor) => void
}

export function MonacoEditorWrapper({ tabId, connectionId, onMount }: MonacoEditorWrapperProps) {
  const monaco = useMonaco()
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null)
  const modelUriRef = useRef<string | undefined>(undefined)
  const themesRegistered = useRef(false)

  const theme = useThemeStore((state) => state.theme)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)

  const content = useQueryStore((state) => state.tabs[tabId]?.content ?? '')
  const setContent = useQueryStore((state) => state.setContent)
  const setCursorPosition = useQueryStore((state) => state.setCursorPosition)

  // Register themes once Monaco is loaded
  useEffect(() => {
    if (monaco && !themesRegistered.current) {
      registerMonacoThemes(monaco)
      themesRegistered.current = true
    }
  }, [monaco])

  // Update Monaco theme when app theme changes
  useEffect(() => {
    if (monaco && themesRegistered.current) {
      const themeName = getMonacoThemeName(theme, resolvedTheme === 'dark')
      monaco.editor.setTheme(themeName)
    }
  }, [monaco, theme, resolvedTheme])

  // Register / unregister model-connection mapping when connectionId changes.
  // Uses modelUriRef (captured at mount time) so cleanup works even if
  // Monaco has already disposed the model (getModel() returns null).
  useEffect(() => {
    if (editorRef.current && connectionId && modelUriRef.current) {
      registerModelConnection(modelUriRef.current, connectionId)
    }
    return () => {
      if (modelUriRef.current) {
        unregisterModelConnection(modelUriRef.current)
      }
    }
  }, [connectionId])

  // Trigger schema cache load on mount / connection change
  useEffect(() => {
    if (connectionId) {
      void loadCache(connectionId)
    }
  }, [connectionId])

  const currentThemeName = getMonacoThemeName(theme, resolvedTheme === 'dark')

  function handleEditorMount(
    editor: MonacoType.editor.IStandaloneCodeEditor,
    monacoInstance: typeof MonacoType
  ) {
    editorRef.current = editor

    // Capture the model URI at mount time so cleanup can use it
    // even after Monaco disposes the model (getModel() returns null).
    modelUriRef.current = editor.getModel()?.uri.toString()

    // Register model-connection mapping on mount
    if (connectionId && modelUriRef.current) {
      registerModelConnection(modelUriRef.current, connectionId)
    }

    // Register themes if not already done
    if (!themesRegistered.current) {
      registerMonacoThemes(monacoInstance)
      themesRegistered.current = true
    }

    // Apply current theme
    const themeName = getMonacoThemeName(theme, resolvedTheme === 'dark')
    monacoInstance.editor.setTheme(themeName)

    // Restore cursor position from the store if available
    const savedPosition = useQueryStore.getState().tabs[tabId]?.cursorPosition
    if (savedPosition) {
      editor.setPosition(savedPosition)
      editor.revealPositionInCenter(savedPosition)
    }

    // Track cursor position changes and persist to store
    const cursorDisposable = editor.onDidChangeCursorPosition((e) => {
      setCursorPosition(tabId, { lineNumber: e.position.lineNumber, column: e.position.column })
    })

    editor.onDidDispose(() => {
      cursorDisposable.dispose()
      // Unregister using the captured URI — model may already be disposed
      if (modelUriRef.current) unregisterModelConnection(modelUriRef.current)
    })

    if (onMount) onMount(editor)
  }

  function handleChange(value: string | undefined) {
    setContent(tabId, value ?? '')
  }

  return (
    <div className={styles.editorContainer} data-testid="monaco-editor-wrapper">
      <Editor
        height="100%"
        language="mysql"
        theme={currentThemeName}
        value={content}
        onChange={handleChange}
        onMount={handleEditorMount}
        options={{
          fontSize: 14,
          lineHeight: 22.4, // 14 * 1.6
          suggestFontSize: 14,
          suggestLineHeight: 36,
          fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'off',
          tabSize: 2,
          insertSpaces: true,
          automaticLayout: true,
          padding: { top: 16, bottom: 16 },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
          suggest: {
            showIcons: true,
            showWords: false,
          },
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
          },
        }}
      />
    </div>
  )
}
