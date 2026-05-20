import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { getMonacoThemeName, registerMonacoThemes } from '../../lib/monaco-theme'
import { useThemeStore } from '../../stores/theme-store'
import { useEditorCallbacks } from './editor-callbacks-context'
import type { CellEditorBaseProps } from './grid-cell-editors'
import styles from './JsonCellEditor.module.css'

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

function safePrettyPrintJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function normalizeJsonString(value: string): string | null {
  try {
    return JSON.stringify(JSON.parse(value))
  } catch {
    return null
  }
}

function resolveCommittedValue(originalValue: string | null, editorValue: string): string | null {
  if (originalValue === null) {
    return editorValue
  }

  const normalizedOriginal = normalizeJsonString(originalValue)
  const normalizedNext = normalizeJsonString(editorValue)

  if (
    normalizedOriginal !== null &&
    normalizedNext !== null &&
    normalizedOriginal === normalizedNext
  ) {
    return originalValue
  }

  return editorValue === originalValue ? originalValue : editorValue
}

function getJsonFallbackValue(originalValue: string | null, prettyPrintedOriginal: string): string {
  if (originalValue !== null) {
    return prettyPrintedOriginal
  }

  return '{}'
}

function getCurrentDomTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

function isCommitKeybinding(event: KeyboardEvent<HTMLDivElement>): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey)
}

function isMonacoInternalMouseTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(
    target.closest(
      '.monaco-scrollable-element, .scrollbar, .slider, .margin, .glyph-margin, .line-numbers'
    )
  )
}

function isNullToggleTarget(target: EventTarget | null, wrapper: HTMLDivElement | null): boolean {
  if (!(target instanceof HTMLElement) || wrapper == null) {
    return false
  }

  const toggle = target.closest('.td-null-toggle')
  return toggle != null && wrapper.contains(toggle)
}

export default function JsonCellEditor(props: CellEditorBaseProps) {
  const { row, column, onRowChange, onClose } = props
  const fieldName = column.key
  const isNullable = props.isNullable ?? false
  const rawValue = row[fieldName]
  const restoreValue = Object.prototype.hasOwnProperty.call(props, 'cancelRestoreValue')
    ? props.cancelRestoreValue
    : rawValue
  const initialNull = isNullish(restoreValue)
  const originalValue = initialNull ? null : String(restoreValue ?? '')
  const initialInputValue = props.initialInputValue
  const prettyPrintedOriginal = useMemo(
    () => (originalValue === null ? '' : safePrettyPrintJson(originalValue)),
    [originalValue]
  )
  const fallbackValue = useMemo(
    () => getJsonFallbackValue(originalValue, prettyPrintedOriginal),
    [originalValue, prettyPrintedOriginal]
  )

  const [isNull, setIsNull] = useState(initialInputValue != null ? false : initialNull)
  const [value, setValue] = useState(
    initialInputValue != null ? initialInputValue : prettyPrintedOriginal
  )
  const [domTheme, setDomTheme] = useState<'light' | 'dark'>(() => getCurrentDomTheme())
  const wrapperRef = useRef<HTMLDivElement>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const isCancellingRef = useRef(false)
  const ignoreNextBlurRef = useRef(false)
  const blurListenerDisposeRef = useRef<(() => void) | null>(null)

  const contextCallbacks = useEditorCallbacks()
  const tabId = props.tabId || contextCallbacks?.tabId || ''
  const updateCellValue = props.tabId
    ? props.updateCellValue
    : (contextCallbacks?.updateCellValue ?? props.updateCellValue)
  const syncCellValue = props.tabId
    ? props.syncCellValue
    : (contextCallbacks?.syncCellValue ?? props.syncCellValue)

  const theme = useThemeStore((state) => state.theme)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const effectiveResolvedTheme = domTheme ?? resolvedTheme
  const effectiveTheme = theme === 'system' ? theme : effectiveResolvedTheme
  const monacoThemeName = getMonacoThemeName(effectiveTheme, effectiveResolvedTheme === 'dark')

  const syncToStore = useCallback(
    (nextValue: unknown) => {
      if (tabId && fieldName && updateCellValue) {
        updateCellValue(tabId, fieldName, nextValue)
        syncCellValue?.(tabId, row, fieldName, nextValue)
      }
    },
    [fieldName, row, syncCellValue, tabId, updateCellValue]
  )

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

  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(monacoThemeName)
    }
  }, [monacoThemeName])

  useEffect(() => {
    return () => {
      blurListenerDisposeRef.current?.()
    }
  }, [])

  useEffect(() => {
    const handleDocumentMouseDownCapture = (event: MouseEvent) => {
      if (!isNullToggleTarget(event.target, wrapperRef.current)) {
        return
      }

      ignoreNextBlurRef.current = true
    }

    document.addEventListener('mousedown', handleDocumentMouseDownCapture, true)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDownCapture, true)
    }
  }, [])

  useEffect(() => {
    if (!isNull) {
      queueMicrotask(() => {
        editorRef.current?.focus()
      })
    }
  }, [isNull])

  const commitValue = useCallback(
    (shouldFocusGrid: boolean) => {
      const committedValue = isNull ? null : resolveCommittedValue(originalValue, value)
      onRowChange({ ...row, [fieldName]: committedValue }, true)
      syncToStore(committedValue)
      onClose(true, shouldFocusGrid)
    },
    [fieldName, isNull, onClose, onRowChange, originalValue, row, syncToStore, value]
  )

  const cancelEdit = useCallback(() => {
    isCancellingRef.current = true
    setIsNull(initialNull)
    setValue(prettyPrintedOriginal)
    onRowChange({ ...row, [fieldName]: restoreValue }, false)
    syncToStore(restoreValue)
    onClose(false, false)
  }, [
    fieldName,
    initialNull,
    onClose,
    onRowChange,
    prettyPrintedOriginal,
    restoreValue,
    row,
    syncToStore,
  ])

  const handleToggleNull = useCallback(() => {
    if (isNull) {
      setIsNull(false)
      setValue(fallbackValue)
      onRowChange({ ...row, [fieldName]: fallbackValue })
      syncToStore(fallbackValue)
      return
    }

    setIsNull(true)
    setValue('')
    onRowChange({ ...row, [fieldName]: null })
    syncToStore(null)
  }, [fallbackValue, fieldName, isNull, onRowChange, row, syncToStore])

  const handleChange = useCallback(
    (nextValue: string) => {
      if (isNull) {
        setIsNull(false)
      }
      setValue(nextValue)
      onRowChange({ ...row, [fieldName]: nextValue })
      syncToStore(nextValue)
    },
    [fieldName, isNull, onRowChange, row, syncToStore]
  )

  const handleBlur = useCallback(
    (relatedTarget: EventTarget | null) => {
      if (isCancellingRef.current) {
        isCancellingRef.current = false
        return
      }

      if (ignoreNextBlurRef.current) {
        ignoreNextBlurRef.current = false
        return
      }

      if (relatedTarget instanceof Node && wrapperRef.current?.contains(relatedTarget)) {
        return
      }

      commitValue(false)
    },
    [commitValue]
  )

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor
      monacoRef.current = monaco
      registerMonacoThemes(monaco)
      monaco.editor.setTheme(monacoThemeName)
      blurListenerDisposeRef.current?.()
      const blurListener = editor.onDidBlurEditorWidget(() => {
        handleBlur(document.activeElement)
      })
      blurListenerDisposeRef.current = () => blurListener.dispose()
      // Disable command palette (F1) — not useful in a cell editor
      editor.addCommand(monaco.KeyCode.F1, () => null)
      editor.focus()
    },
    [handleBlur, monacoThemeName]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancelEdit()
        return
      }

      if (isCommitKeybinding(event)) {
        event.preventDefault()
        event.stopPropagation()
        commitValue(true)
      }
    },
    [cancelEdit, commitValue]
  )

  const handleInternalControlMouseDown = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    ignoreNextBlurRef.current = true
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return (
    <div
      ref={wrapperRef}
      className={`${styles.editorWrapper} click-outside-ignore`}
      data-testid="json-cell-editor"
      onKeyDownCapture={handleKeyDown}
      onMouseDownCapture={(event) => {
        if (isMonacoInternalMouseTarget(event.target)) {
          event.preventDefault()
        }
      }}
    >
      <div
        className={styles.editorSurface}
        data-null={isNull ? 'true' : 'false'}
        data-testid="json-cell-editor-surface"
      >
        {isNull ? (
          'NULL'
        ) : (
          <Editor
            height="100%"
            defaultLanguage="json"
            language="json"
            value={value}
            theme={monacoThemeName}
            onMount={handleEditorMount}
            onChange={(nextValue) => {
              handleChange(nextValue ?? '')
            }}
            options={{
              automaticLayout: true,
              minimap: { enabled: false },
              lineNumbers: 'off',
              scrollBeyondLastLine: false,
              wordWrap: 'off',
              tabSize: 2,
              contextmenu: false,
              quickSuggestions: false,
            }}
          />
        )}
      </div>
      <div className={styles.editorMarkerGroup}>
        {isNullable ? (
          <button
            type="button"
            className={`td-null-toggle click-outside-ignore ${isNull ? 'td-null-active' : ''}`}
            onMouseDown={handleInternalControlMouseDown}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              handleToggleNull()
              queueMicrotask(() => {
                ignoreNextBlurRef.current = false
              })
            }}
            tabIndex={-1}
          >
            NULL
          </button>
        ) : null}
      </div>
    </div>
  )
}
