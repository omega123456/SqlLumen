/**
 * Monaco Editor React wrapper with MySQL syntax highlighting,
 * theme switching, query store integration, and autocomplete.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import type * as MonacoType from 'monaco-editor'
import { useThemeStore } from '../../stores/theme-store'
import { useQueryStore } from '../../stores/query-store'
import { useAiStore } from '../../stores/ai-store'
import { useFavoritesStore } from '../../stores/favorites-store'
import { resolveFavoriteSql, buildFavoriteDraft } from './save-favorite-utils'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../stores/settings-store'
import { useShortcutStore } from '../../stores/shortcut-store'
import { registerMonacoThemes, getMonacoThemeName } from '../../lib/monaco-theme'
import { registerModelConnection, unregisterModelConnection } from './completion-service'
import type { ShortcutBinding, TabType } from '../../types/schema'
import styles from './MonacoEditorWrapper.module.css'

// Register the 'mysql' language with Monaco (side-effect import)
import 'monaco-sql-languages/esm/languages/mysql/mysql.contribution.js'

// Setup language features with our custom completionService (side-effect import)
import './mysql-language-setup'

// Register signature help provider for function parameter hints (side-effect import)
import './signature-help-provider'

// Register CodeLens provider for Run + Ask AI per statement (side-effect import)
import './codelens-provider'
import { isAiLockStatus, isEditorLockStatus } from '../../lib/query-tab-status'

const DEFAULT_EDITOR_FONT_SIZE = Number(SETTINGS_DEFAULTS['editor.fontSize'])
const DEFAULT_EDITOR_LINE_HEIGHT = Number(SETTINGS_DEFAULTS['editor.lineHeight'])

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
const COMMA_KEY_NAMES: ReadonlySet<string> = new Set([',', 'COMMA'])

type MonacoShortcutActionId = (typeof MONACO_SHORTCUT_ACTIONS)[number]

// Hoisted so nested option objects keep their identity. Every updateOptions()
// call fires a global config event that Monaco handles by walking all models.
const STATIC_EDITOR_OPTIONS: MonacoType.editor.IStandaloneEditorConstructionOptions = {
  suggestFontSize: 14,
  suggestLineHeight: 36,
  scrollBeyondLastLine: false,
  tabSize: 2,
  insertSpaces: true,
  automaticLayout: true,
  fixedOverflowWidgets: true,
  // Prototype `.p-editor`: 8px top inset, a 48px gutter with numbers ending 14px before the code,
  // and the current line only highlighted while the editor has focus (`.p-code:focus`).
  padding: { top: 8, bottom: 16 },
  lineNumbersMinChars: 4,
  lineDecorationsWidth: 14,
  showFoldingControls: 'never',
  renderLineHighlight: 'line',
  renderLineHighlightOnlyWhenFocus: true,
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
}

function getMonacoKeyCode(key: string, monacoInstance: typeof MonacoType): number | null {
  const normalizedKey = key.trim().toUpperCase()
  if (normalizedKey === '') {
    return null
  }

  if (/^[A-Z]$/.test(normalizedKey)) {
    const letterCode =
      monacoInstance.KeyCode[`Key${normalizedKey}` as keyof typeof monacoInstance.KeyCode]
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

  if (COMMA_KEY_NAMES.has(normalizedKey)) {
    return monacoInstance.KeyCode.Comma
  }

  return null
}

const MONACO_KEY_MOD_BY_MODIFIER: Partial<Record<string, 'CtrlCmd' | 'Shift' | 'Alt'>> = {
  ctrl: 'CtrlCmd',
  shift: 'Shift',
  alt: 'Alt',
}

function getMonacoModifierMask(
  modifiers: ShortcutBinding['modifiers'],
  monacoInstance: typeof MonacoType
): number {
  return modifiers.reduce((mask, modifier) => {
    const keyModName = MONACO_KEY_MOD_BY_MODIFIER[modifier]
    if (!keyModName) return mask
    return mask | monacoInstance.KeyMod[keyModName]
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

type StandaloneEditor = MonacoType.editor.IStandaloneCodeEditor

function restoreCursorPosition(editor: StandaloneEditor, tabId: string): void {
  const savedPosition = useQueryStore.getState().tabs[tabId]?.cursorPosition
  if (!savedPosition) return
  editor.setPosition(savedPosition)
  editor.revealPositionInCenter(savedPosition)
}

function saveFavoriteFromEditor(
  editor: MonacoType.editor.ICodeEditor,
  connectionId: string | undefined
): void {
  const model = editor.getModel()
  if (!model) return

  const selection = editor.getSelection()
  const selectedText = selection ? model.getValueInRange(selection) : ''
  const position = editor.getPosition()
  const sql = resolveFavoriteSql(
    model.getValue(),
    selectedText,
    position ? { lineNumber: position.lineNumber, column: position.column } : null
  )
  if (!sql) return

  useFavoritesStore.getState().openDialog(buildFavoriteDraft(sql, connectionId ?? null))
}

function syncAttachedContextToEditor(editor: StandaloneEditor, tabId: string): void {
  const context = useAiStore.getState().tabs[tabId]?.attachedContext
  if (!context) return
  const editorModel = editor.getModel()
  if (!editorModel) return
  const lineCount = editorModel.getLineCount()
  useAiStore.getState().setAttachedContext(tabId, {
    sql: editorModel.getValue(),
    range: {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: lineCount,
      endColumn: editorModel.getLineLength(lineCount) + 1,
    },
  })
}

interface QueryStoreEditorBinding {
  editor: StandaloneEditor
  tabId: string
  connectionId: string | undefined
  syncSelectedText: () => void
}

function bindQueryStoreEditorEvents(binding: QueryStoreEditorBinding): MonacoType.IDisposable[] {
  const { editor, tabId } = binding
  const cursorDisposable = editor.onDidChangeCursorPosition((event) => {
    useQueryStore.getState().setCursorPosition(tabId, {
      lineNumber: event.position.lineNumber,
      column: event.position.column,
    })
  })
  const selectionDisposable = editor.onDidChangeCursorSelection(() => {
    binding.syncSelectedText()
  })
  binding.syncSelectedText()

  // Right-click "Save as favorite" — pre-populates the favorites dialog
  // with the current selection, or the statement under the cursor.
  const saveFavoriteActionDisposable = editor.addAction({
    id: 'sqllumen.save-as-favorite',
    label: 'Save as favorite',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.5,
    run: (codeEditor) => saveFavoriteFromEditor(codeEditor, binding.connectionId),
  })
  return [cursorDisposable, selectionDisposable, saveFavoriteActionDisposable]
}

function registerShortcutCommands(
  editor: StandaloneEditor,
  monacoInstance: typeof MonacoType,
  bindings: Record<(typeof MONACO_SHORTCUT_ACTIONS)[number], ShortcutBinding>
): void {
  for (const actionId of MONACO_SHORTCUT_ACTIONS) {
    const keybinding = getMonacoKeybinding(bindings[actionId], monacoInstance)
    if (keybinding === null) {
      continue
    }

    editor.addCommand(keybinding, () => {
      useShortcutStore.getState().dispatchAction(actionId)
    })
  }
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
  const isReadOnly = overrideReadOnly ?? isEditorLockStatus(status)
  const isAiLocked = overrideReadOnly === undefined && isAiLockStatus(status)

  // Register themes once Monaco is loaded
  useEffect(() => {
    if (!monaco) return
    if (themesRegistered.current) return
    registerMonacoThemes(monaco)
    themesRegistered.current = true
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
    const unregisterOnCleanup = () => {
      if (modelUriRef.current) {
        unregisterModelConnection(modelUriRef.current)
      }
    }
    const modelUri = modelUriRef.current
    if (!editorRef.current) return unregisterOnCleanup
    if (!connectionId) return unregisterOnCleanup
    if (!modelUri) return unregisterOnCleanup
    registerModelConnection(modelUri, connectionId, tabId, tabType)
    return unregisterOnCleanup
  }, [connectionId, tabId, tabType])

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
      restoreCursorPosition(editor, tabId)
    }

    const syncSelectedText = () => {
      if (isOverrideMode) return

      const model = editor.getModel()
      const selection = editor.getSelection()
      setSelectedText(tabId, model && selection ? model.getValueInRange(selection) : '')
    }

    // Track cursor position changes and persist to store (only in query-store mode)
    const queryStoreDisposables = isOverrideMode
      ? []
      : bindQueryStoreEditorEvents({
          editor: editor,
          tabId: tabId,
          connectionId: connectionId,
          syncSelectedText: syncSelectedText,
        })

    // Keep the selection and AI attached context in sync when the user edits inline.
    // (Monaco's CodeLens controller already refreshes this editor's lenses on edit.)
    const contentChangeDisposable = editor.onDidChangeModelContent(() => {
      syncSelectedText()

      // If there is an attached AI context for this tab, update its SQL to
      // reflect the current editor content so that followup AI prompts
      // reference the latest text, not a stale snapshot.
      syncAttachedContextToEditor(editor, tabId)
    })

    // Ctrl+H / Ctrl+Shift+R open find & replace. Bound to both Ctrl and Cmd,
    // matching how the app's shortcut system treats 'ctrl' (ctrlKey || metaKey).
    const { KeyMod, KeyCode } = monacoInstance
    const findReplaceActionDisposable = editor.addAction({
      id: 'sqllumen.find-replace',
      label: 'Find and replace',
      keybindings: [KeyMod.CtrlCmd, KeyMod.WinCtrl].flatMap((modifier) => [
        modifier | KeyCode.KeyH,
        modifier | KeyMod.Shift | KeyCode.KeyR,
      ]),
      run: (ed) => ed.getAction('editor.action.startFindReplaceAction')?.run(),
    })

    editor.onDidDispose(() => {
      queryStoreDisposables.forEach((disposable) => disposable.dispose())
      findReplaceActionDisposable.dispose()
      contentChangeDisposable.dispose()
      // Unregister using the captured URI — model may already be disposed
      if (modelUriRef.current) unregisterModelConnection(modelUriRef.current)
    })

    // Register Monaco-local keybindings so they are dispatched through the
    // shortcut system even when the editor captures key events before the
    // global listener.
    registerShortcutCommands(editor, monacoInstance, monacoShortcutBindings)

    if (onMount) onMount(editor)
  }

  // Memoized so @monaco-editor/react only calls updateOptions() on real changes.
  const editorOptions = useMemo(
    () => ({
      ...STATIC_EDITOR_OPTIONS,
      readOnly: isReadOnly,
      fontSize: editorFontSize || DEFAULT_EDITOR_FONT_SIZE,
      lineHeight:
        (editorFontSize || DEFAULT_EDITOR_FONT_SIZE) *
        (editorLineHeight || DEFAULT_EDITOR_LINE_HEIGHT),
      fontFamily: `'${editorFontFamily}', 'Fira Code', ui-monospace, monospace`,
      minimap: { enabled: editorMinimap },
      lineNumbers: editorLineNumbers ? ('on' as const) : ('off' as const),
      wordWrap: editorWordWrap ? ('on' as const) : ('off' as const),
    }),
    [
      isReadOnly,
      editorFontSize,
      editorLineHeight,
      editorFontFamily,
      editorMinimap,
      editorLineNumbers,
      editorWordWrap,
    ]
  )

  // Stable identity: the library re-subscribes onDidChangeModelContent whenever onChange changes.
  const handleChange = useCallback(
    (value: string | undefined) => {
      const editorValue = value ?? ''
      if (overrideOnChange) {
        overrideOnChange(editorValue)
        return
      }
      setContent(tabId, editorValue)
    },
    [overrideOnChange, setContent, tabId]
  )

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
        options={editorOptions}
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

export default MonacoEditorWrapper
