/**
 * Monaco Editor React wrapper with MySQL syntax highlighting,
 * theme switching, query store integration, and autocomplete.
 */

import { useEffect, useRef } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import type * as MonacoType from 'monaco-editor'
import { useThemeStore } from '../../stores/theme-store'
import { useQueryStore } from '../../stores/query-store'
import { useAiStore } from '../../stores/ai-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useShortcutStore } from '../../stores/shortcut-store'
import { registerMonacoThemes, getMonacoThemeName } from './monaco-theme'
import { registerModelConnection, unregisterModelConnection } from './completion-service'
import { loadCache } from './schema-metadata-cache'
import type { TabType } from '../../types/schema'
import styles from './MonacoEditorWrapper.module.css'

// Register the 'mysql' language with Monaco (side-effect import)
import 'monaco-sql-languages/esm/languages/mysql/mysql.contribution'

// Setup language features with our custom completionService (side-effect import)
import './mysql-language-setup'

// Register signature help provider for function parameter hints (side-effect import)
import './signature-help-provider'

// Register CodeLens provider for Run + Ask AI per statement (side-effect import)
import './codelens-provider'
import { triggerCodeLensRefresh } from './codelens-provider'

interface MonacoEditorWrapperProps {
  tabId: string
  /** Connection ID for schema-aware autocomplete */
  connectionId?: string
  /** Tab type for CodeLens gating (defaults to 'query-editor') */
  tabType?: TabType
  /** Called with the Monaco editor instance after mount */
  onMount?: (editor: MonacoType.editor.IStandaloneCodeEditor) => void
  /** Override value — when provided, bypasses query-store content binding */
  value?: string
  /** Override onChange — when provided, bypasses query-store setContent binding */
  onChange?: (value: string) => void
  /** Override readOnly — when provided, bypasses status-based readOnly computation */
  readOnly?: boolean
}

export function MonacoEditorWrapper({
  tabId,
  connectionId,
  tabType = 'query-editor',
  onMount,
  value: overrideValue,
  onChange: overrideOnChange,
  readOnly: overrideReadOnly,
}: MonacoEditorWrapperProps) {
  const monaco = useMonaco()
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null)
  const modelUriRef = useRef<string | undefined>(undefined)
  const themesRegistered = useRef(false)

  const theme = useThemeStore((state) => state.theme)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)

  const content = useQueryStore((state) => state.tabs[tabId]?.content ?? '')
  const status = useQueryStore((state) => state.tabs[tabId]?.tabStatus ?? 'idle')
  const setContent = useQueryStore((state) => state.setContent)
  const setCursorPosition = useQueryStore((state) => state.setCursorPosition)

  // Read editor settings from the settings store
  const editorFontFamily = useSettingsStore((state) => state.getSetting('editor.fontFamily'))
  const editorFontSize = useSettingsStore((state) =>
    parseInt(state.getSetting('editor.fontSize'), 10)
  )
  const editorLineHeight = useSettingsStore((state) =>
    parseFloat(state.getSetting('editor.lineHeight'))
  )
  const editorWordWrap = useSettingsStore((state) => state.getSetting('editor.wordWrap') === 'true')
  const editorMinimap = useSettingsStore((state) => state.getSetting('editor.minimap') === 'true')
  const editorLineNumbers = useSettingsStore(
    (state) => state.getSetting('editor.lineNumbers') === 'true'
  )

  // Determine whether we are using override props (object-editor mode) or query-store bindings
  const isOverrideMode = overrideValue !== undefined
  const effectiveContent = isOverrideMode ? overrideValue : content
  const isReadOnly =
    overrideReadOnly !== undefined
      ? overrideReadOnly
      : status === 'running' || status === 'ai-pending' || status === 'ai-reviewing'
  const isAiLocked =
    overrideReadOnly === undefined && (status === 'ai-pending' || status === 'ai-reviewing')

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
      registerModelConnection(modelUriRef.current, connectionId, tabId, tabType)
    }
    return () => {
      if (modelUriRef.current) {
        unregisterModelConnection(modelUriRef.current)
      }
    }
  }, [connectionId, tabId, tabType])

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
      registerModelConnection(modelUriRef.current, connectionId, tabId, tabType)
    }

    // Register themes if not already done
    if (!themesRegistered.current) {
      registerMonacoThemes(monacoInstance)
      themesRegistered.current = true
    }

    // Apply current theme
    const themeName = getMonacoThemeName(theme, resolvedTheme === 'dark')
    monacoInstance.editor.setTheme(themeName)

    // Restore cursor position from the store if available (only in query-store mode)
    if (!isOverrideMode) {
      const savedPosition = useQueryStore.getState().tabs[tabId]?.cursorPosition
      if (savedPosition) {
        editor.setPosition(savedPosition)
        editor.revealPositionInCenter(savedPosition)
      }
    }

    // Track cursor position changes and persist to store (only in query-store mode)
    let cursorDisposable: MonacoType.IDisposable | null = null
    if (!isOverrideMode) {
      cursorDisposable = editor.onDidChangeCursorPosition((e) => {
        setCursorPosition(tabId, { lineNumber: e.position.lineNumber, column: e.position.column })
      })
    }

    // Subscribe to content changes so CodeLens positions refresh as the user types.
    // Also keep the AI attached context in sync when the user edits inline.
    const contentChangeDisposable = editor.onDidChangeModelContent(() => {
      triggerCodeLensRefresh()

      // If there is an attached AI context for this tab, update its SQL to
      // reflect the current editor content so that followup AI prompts
      // reference the latest text, not a stale snapshot.
      const aiTab = useAiStore.getState().tabs[tabId]
      const ctx = aiTab?.attachedContext
      if (ctx) {
        const editorModel = editor.getModel()
        if (editorModel) {
          const fullContent = editorModel.getValue()
          const lineCount = editorModel.getLineCount()
          const lastLineLength = editorModel.getLineLength(lineCount)
          useAiStore.getState().setAttachedContext(tabId, {
            sql: fullContent,
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: lineCount,
              endColumn: lastLineLength + 1,
            },
          })
        }
      }
    })

    editor.onDidDispose(() => {
      cursorDisposable?.dispose()
      contentChangeDisposable.dispose()
      // Unregister using the captured URI — model may already be disposed
      if (modelUriRef.current) unregisterModelConnection(modelUriRef.current)
    })

    // Register F9 (Execute Query) and F12 (Format Query) as Monaco keybindings
    // so they are dispatched through the shortcut system even when the editor is
    // focused and captures key events before the global listener.
    editor.addCommand(monacoInstance.KeyCode.F9, () => {
      useShortcutStore.getState().dispatchAction('execute-query')
    })
    editor.addCommand(monacoInstance.KeyCode.F12, () => {
      useShortcutStore.getState().dispatchAction('format-query')
    })

    if (onMount) onMount(editor)
  }

  // Subscribe to settings changes and update the live editor instance
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.updateOptions({
      fontFamily: `'${editorFontFamily}', 'Fira Code', ui-monospace, monospace`,
      fontSize: editorFontSize || 14,
      lineHeight: (editorFontSize || 14) * (editorLineHeight || 1.6),
      wordWrap: editorWordWrap ? 'on' : 'off',
      minimap: { enabled: editorMinimap },
      lineNumbers: editorLineNumbers ? 'on' : 'off',
    })
  }, [
    editorFontFamily,
    editorFontSize,
    editorLineHeight,
    editorWordWrap,
    editorMinimap,
    editorLineNumbers,
  ])

  function handleChange(value: string | undefined) {
    const v = value ?? ''
    if (overrideOnChange) {
      overrideOnChange(v)
    } else {
      setContent(tabId, v)
    }
  }

  return (
    <div className={styles.editorContainer} data-testid="monaco-editor-wrapper">
      <Editor
        height="100%"
        language="mysql"
        theme={currentThemeName}
        value={effectiveContent}
        onChange={handleChange}
        onMount={handleEditorMount}
        options={{
          readOnly: isReadOnly,
          fontSize: editorFontSize || 14,
          lineHeight: (editorFontSize || 14) * (editorLineHeight || 1.6),
          suggestFontSize: 14,
          suggestLineHeight: 36,
          fontFamily: `'${editorFontFamily}', 'Fira Code', ui-monospace, monospace`,
          minimap: { enabled: editorMinimap },
          lineNumbers: editorLineNumbers ? 'on' : 'off',
          scrollBeyondLastLine: false,
          wordWrap: editorWordWrap ? 'on' : 'off',
          tabSize: 2,
          insertSpaces: true,
          automaticLayout: true,
          fixedOverflowWidgets: true,
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
          parameterHints: { enabled: true },
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
          },
        }}
      />
      {isAiLocked && (
        <div
          className={styles.aiPendingOverlay}
          data-testid="ai-pending-overlay"
          role="status"
          aria-label="Waiting for AI"
        >
          <div className={styles.aiPendingCard}>
            <span className={styles.aiSpinner} aria-hidden="true" />
            <span className={styles.aiPendingLabel}>Waiting for AI…</span>
          </div>
        </div>
      )}
    </div>
  )
}
