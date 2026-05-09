/**
 * Monaco Editor React wrapper with MySQL syntax highlighting,
 * theme switching, query store integration, and autocomplete.
 */

import { useEffect, useRef, useState } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import type * as MonacoType from 'monaco-editor'
import { useThemeStore } from '../../stores/theme-store'
import { useQueryStore } from '../../stores/query-store'
import { useAiStore } from '../../stores/ai-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useShortcutStore } from '../../stores/shortcut-store'
import {
  createGridPerformanceLogger,
  type GridPerformanceLogger,
} from '../../lib/grid-performance-logger'
import { registerMonacoThemes, getMonacoThemeName } from './monaco-theme'
import { registerModelConnection, unregisterModelConnection } from './completion-service'
import { loadCache } from './schema-metadata-cache'
import type { ShortcutBinding, TabType } from '../../types/schema'
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

const MONACO_SHORTCUT_ACTIONS = ['execute-query', 'format-query', 'new-query-tab'] as const
const MONACO_PERF_SCOPE = 'query-editor'
const SLOW_MONACO_HANDLER_MS = 16
const SLOW_MONACO_RENDER_COMMIT_MS = 50

type MonacoShortcutActionId = (typeof MONACO_SHORTCUT_ACTIONS)[number]

function readPerformanceNow(): number {
  return globalThis.performance?.now() ?? Date.now()
}

function getMonacoKeyCode(
  key: string,
  monacoInstance: typeof MonacoType
): number | null {
  const normalizedKey = key.trim().toUpperCase()
  if (normalizedKey === '') {
    return null
  }

  if (/^[A-Z]$/.test(normalizedKey)) {
    const letterCode = monacoInstance.KeyCode[`Key${normalizedKey}` as keyof typeof monacoInstance.KeyCode]
    return typeof letterCode === 'number' ? letterCode : null
  }

  if (/^F([1-9]|1[0-2])$/.test(normalizedKey)) {
    const functionKeyCode =
      monacoInstance.KeyCode[normalizedKey as keyof typeof monacoInstance.KeyCode]
    return typeof functionKeyCode === 'number' ? functionKeyCode : null
  }

  if (normalizedKey === 'ENTER') {
    return monacoInstance.KeyCode.Enter
  }

  if (normalizedKey === 'TAB') {
    return monacoInstance.KeyCode.Tab
  }

  if (normalizedKey === ',' || normalizedKey === 'COMMA') {
    return monacoInstance.KeyCode.Comma
  }

  return null
}

function getMonacoModifierMask(
  modifiers: ShortcutBinding['modifiers'],
  monacoInstance: typeof MonacoType
): number {
  return modifiers.reduce((mask, modifier) => {
    switch (modifier) {
      case 'ctrl':
        return mask | monacoInstance.KeyMod.CtrlCmd
      case 'shift':
        return mask | monacoInstance.KeyMod.Shift
      case 'alt':
        return mask | monacoInstance.KeyMod.Alt
      default:
        return mask
    }
  }, 0)
}

function getMonacoKeybinding(
  binding: ShortcutBinding,
  monacoInstance: typeof MonacoType
): number | null {
  const keyCode = getMonacoKeyCode(binding.key, monacoInstance)
  if (keyCode === null) {
    return null
  }

  return getMonacoModifierMask(binding.modifiers, monacoInstance) | keyCode
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
  const renderStartedAt = readPerformanceNow()
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
  const setSelectedText = useQueryStore((state) => state.setSelectedText)

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
  const executeQueryShortcut = useShortcutStore((state) => state.shortcuts['execute-query'])
  const formatQueryShortcut = useShortcutStore((state) => state.shortcuts['format-query'])
  const newQueryTabShortcut = useShortcutStore((state) => state.shortcuts['new-query-tab'])

  // Determine whether we are using override props (object-editor mode) or query-store bindings
  const isOverrideMode = overrideValue !== undefined
  const effectiveContent = isOverrideMode ? overrideValue : content
  const isReadOnly =
    overrideReadOnly !== undefined
      ? overrideReadOnly
      : status === 'running' || status === 'ai-pending' || status === 'ai-reviewing'
  const isAiLocked =
    overrideReadOnly === undefined && (status === 'ai-pending' || status === 'ai-reviewing')
  const performanceContext = {
    scope: MONACO_PERF_SCOPE,
    tabId,
    view: 'sql-editor',
    editMode: isReadOnly ? 'read-only' : 'editable',
  }
  const [performanceLogger] = useState<GridPerformanceLogger>(() =>
    createGridPerformanceLogger(performanceContext)
  )

  useEffect(() => {
    performanceLogger.updateContext(performanceContext)
  }, [isReadOnly, performanceLogger, tabId])

  useEffect(() => {
    performanceLogger.logMount()
    return () => {
      performanceLogger.flush('unmount')
    }
  }, [performanceLogger])

  useEffect(() => {
    performanceLogger.recordTiming('editor-render-commit', readPerformanceNow() - renderStartedAt, {
      thresholdMs: SLOW_MONACO_RENDER_COMMIT_MS,
      fields: {
        contentLength: effectiveContent.length,
      },
    })
  })

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
  const monacoShortcutBindings: Record<MonacoShortcutActionId, ShortcutBinding> = {
    'execute-query': executeQueryShortcut,
    'format-query': formatQueryShortcut,
    'new-query-tab': newQueryTabShortcut,
  }
  const monacoShortcutSignature = MONACO_SHORTCUT_ACTIONS.map((actionId) => {
    const binding = monacoShortcutBindings[actionId]
    return `${actionId}:${binding.key}:${binding.modifiers.slice().sort().join('+')}`
  }).join('|')

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
    let selectionDisposable: MonacoType.IDisposable | null = null
    const syncSelectedText = () => {
      if (isOverrideMode) return

      const model = editor.getModel()
      const selection = editor.getSelection()
      setSelectedText(tabId, model && selection ? model.getValueInRange(selection) : '')
    }

    if (!isOverrideMode) {
      cursorDisposable = editor.onDidChangeCursorPosition((e) => {
        const startedAt = readPerformanceNow()
        setCursorPosition(tabId, { lineNumber: e.position.lineNumber, column: e.position.column })
        performanceLogger.recordTiming(
          'editor-cursor-position-handler',
          readPerformanceNow() - startedAt,
          {
            thresholdMs: SLOW_MONACO_HANDLER_MS,
          }
        )
      })

      selectionDisposable = editor.onDidChangeCursorSelection(() => {
        const startedAt = readPerformanceNow()
        syncSelectedText()
        performanceLogger.recordTiming(
          'editor-selection-handler',
          readPerformanceNow() - startedAt,
          {
            thresholdMs: SLOW_MONACO_HANDLER_MS,
          }
        )
      })

      syncSelectedText()
    }

    // Subscribe to content changes so CodeLens positions refresh as the user types.
    // Also keep the AI attached context in sync when the user edits inline.
    const contentChangeDisposable = editor.onDidChangeModelContent(() => {
      const startedAt = readPerformanceNow()
      performanceLogger.increment('editor-model-content-change')
      triggerCodeLensRefresh()
      syncSelectedText()

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
      performanceLogger.recordTiming(
        'editor-model-content-handler',
        readPerformanceNow() - startedAt,
        {
          thresholdMs: SLOW_MONACO_HANDLER_MS,
        }
      )
    })

    editor.onDidDispose(() => {
      cursorDisposable?.dispose()
      selectionDisposable?.dispose()
      contentChangeDisposable.dispose()
      // Unregister using the captured URI — model may already be disposed
      if (modelUriRef.current) unregisterModelConnection(modelUriRef.current)
    })

    // Register Monaco-local keybindings so they are dispatched through the
    // shortcut system even when the editor captures key events before the
    // global listener.
    for (const actionId of MONACO_SHORTCUT_ACTIONS) {
      const binding = monacoShortcutBindings[actionId]
      const keybinding = getMonacoKeybinding(binding, monacoInstance)
      if (keybinding === null) {
        continue
      }

      editor.addCommand(keybinding, () => {
        useShortcutStore.getState().dispatchAction(actionId)
      })
    }

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
    const startedAt = readPerformanceNow()
    const v = value ?? ''
    if (overrideOnChange) {
      overrideOnChange(v)
    } else {
      setContent(tabId, v)
    }
    performanceLogger.recordTiming('editor-on-change', readPerformanceNow() - startedAt, {
      thresholdMs: SLOW_MONACO_HANDLER_MS,
      fields: {
        contentLength: v.length,
      },
    })
  }

  return (
    <div className={styles.editorContainer} data-testid="monaco-editor-wrapper">
      <Editor
        key={monacoShortcutSignature}
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
