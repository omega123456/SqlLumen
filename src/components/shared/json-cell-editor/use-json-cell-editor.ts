import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import type { OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { prettyPrintJson } from '../../../lib/json-text'
import { isTargetInside } from '../../../lib/input-events'
import { registerMonacoThemes } from '../../../lib/monaco-theme'
import { useCellStoreSync } from '../editor-callbacks-context'
import type { CellEditorBaseProps } from '../grid-cell-editors'
import {
  getJsonFallbackValue,
  isCommitKeybinding,
  isNullToggleTarget,
  originalJsonText,
  resolveCommittedValue,
  resolveRestoreValue,
} from './json-cell-editor-values'
import { useJsonEditorThemeName } from './use-json-editor-theme-name'

export interface JsonEditorRefs {
  wrapperRef: RefObject<HTMLDivElement | null>
  monacoRef: RefObject<typeof Monaco | null>
  editorRef: RefObject<Monaco.editor.IStandaloneCodeEditor | null>
  isCancellingRef: RefObject<boolean>
  ignoreNextBlurRef: RefObject<boolean>
  blurListenerDisposeRef: RefObject<(() => void) | null>
}

function useJsonEditorSource(props: CellEditorBaseProps) {
  const restoreValue = resolveRestoreValue(props)
  const originalValue = originalJsonText(restoreValue)
  const prettyPrintedOriginal = useMemo(
    () => (originalValue === null ? '' : prettyPrintJson(originalValue)),
    [originalValue]
  )
  const fallbackValue = useMemo(
    () => getJsonFallbackValue(originalValue, prettyPrintedOriginal),
    [originalValue, prettyPrintedOriginal]
  )
  return {
    restoreValue: restoreValue,
    originalValue: originalValue,
    initialNull: originalValue === null,
    prettyPrintedOriginal: prettyPrintedOriginal,
    fallbackValue: fallbackValue,
  }
}

function useJsonEditorRefs(): JsonEditorRefs {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const isCancellingRef = useRef(false)
  const ignoreNextBlurRef = useRef(false)
  const blurListenerDisposeRef = useRef<(() => void) | null>(null)
  return {
    wrapperRef,
    monacoRef,
    editorRef,
    isCancellingRef,
    ignoreNextBlurRef,
    blurListenerDisposeRef,
  }
}

function disposeBlurListener(
  blurListenerDisposeRef: JsonEditorRefs['blurListenerDisposeRef']
): void {
  blurListenerDisposeRef.current?.()
}

function useJsonEditorEffects(refs: JsonEditorRefs, monacoThemeName: string, isNull: boolean) {
  const { wrapperRef, monacoRef, editorRef, ignoreNextBlurRef, blurListenerDisposeRef } = refs
  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(monacoThemeName)
    }
  }, [monacoRef, monacoThemeName])

  useEffect(() => {
    return () => disposeBlurListener(blurListenerDisposeRef)
  }, [blurListenerDisposeRef])

  useEffect(() => {
    const handleDocumentMouseDownCapture = (event: globalThis.MouseEvent) => {
      if (!isNullToggleTarget(event.target, wrapperRef.current)) return
      ignoreNextBlurRef.current = true
    }
    document.addEventListener('mousedown', handleDocumentMouseDownCapture, true)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDownCapture, true)
    }
  }, [ignoreNextBlurRef, wrapperRef])

  useEffect(() => {
    if (isNull) return
    queueMicrotask(() => {
      editorRef.current?.focus()
    })
  }, [editorRef, isNull])
}

function useJsonValueState(props: CellEditorBaseProps) {
  const source = useJsonEditorSource(props)
  const { initialInputValue } = props
  const [isNull, setIsNull] = useState(initialInputValue == null && source.initialNull)
  const [value, setValue] = useState(initialInputValue ?? source.prettyPrintedOriginal)
  return { source, isNull, setIsNull, value, setValue }
}

type JsonValueState = ReturnType<typeof useJsonValueState>

function useJsonCommitActions(
  props: CellEditorBaseProps,
  state: JsonValueState,
  refs: JsonEditorRefs
) {
  const { row, column, onRowChange, onClose } = props
  const fieldName = column.key
  const { source, isNull, value, setIsNull, setValue } = state
  const { originalValue, initialNull, prettyPrintedOriginal, restoreValue } = source
  const { isCancellingRef } = refs
  const syncToStore = useCellStoreSync(props)

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
    isCancellingRef,
    onClose,
    onRowChange,
    prettyPrintedOriginal,
    restoreValue,
    row,
    setIsNull,
    setValue,
    syncToStore,
  ])

  return { commitValue, cancelEdit, syncToStore }
}

function useJsonEditActions(
  props: CellEditorBaseProps,
  state: JsonValueState,
  syncToStore: (value: unknown) => void
) {
  const { row, column, onRowChange } = props
  const fieldName = column.key
  const { isNull, setIsNull, setValue } = state
  const { fallbackValue } = state.source

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
  }, [fallbackValue, fieldName, isNull, onRowChange, row, setIsNull, setValue, syncToStore])

  const handleChange = useCallback(
    (nextValue: string) => {
      if (isNull) {
        setIsNull(false)
      }
      setValue(nextValue)
      onRowChange({ ...row, [fieldName]: nextValue })
      syncToStore(nextValue)
    },
    [fieldName, isNull, onRowChange, row, setIsNull, setValue, syncToStore]
  )

  return { handleToggleNull, handleChange }
}

function useJsonBlurHandler(refs: JsonEditorRefs, commitValue: (shouldFocusGrid: boolean) => void) {
  const { isCancellingRef, ignoreNextBlurRef, wrapperRef } = refs
  return useCallback(
    (relatedTarget: EventTarget | null) => {
      if (isCancellingRef.current) {
        isCancellingRef.current = false
        return
      }

      if (ignoreNextBlurRef.current) {
        ignoreNextBlurRef.current = false
        return
      }

      if (isTargetInside(wrapperRef.current, relatedTarget)) {
        return
      }

      commitValue(false)
    },
    [commitValue, ignoreNextBlurRef, isCancellingRef, wrapperRef]
  )
}

function useJsonEditorMount(
  refs: JsonEditorRefs,
  monacoThemeName: string,
  handleBlur: (relatedTarget: EventTarget | null) => void
): OnMount {
  const { editorRef, monacoRef, blurListenerDisposeRef } = refs
  return useCallback(
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
      editor.addCommand(monaco.KeyCode.F1, () => null)
      editor.focus()
    },
    [blurListenerDisposeRef, editorRef, handleBlur, monacoRef, monacoThemeName]
  )
}

interface JsonKeyboardActions {
  commitValue: (shouldFocusGrid: boolean) => void
  cancelEdit: () => void
  handleToggleNull: () => void
}

function stopEvent(event: { preventDefault: () => void; stopPropagation: () => void }): void {
  event.preventDefault()
  event.stopPropagation()
}

function useJsonEditorControls(refs: JsonEditorRefs, actions: JsonKeyboardActions) {
  const { ignoreNextBlurRef } = refs
  const { commitValue, cancelEdit, handleToggleNull } = actions

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        stopEvent(event)
        cancelEdit()
        return
      }
      if (!isCommitKeybinding(event)) return
      stopEvent(event)
      commitValue(true)
    },
    [cancelEdit, commitValue]
  )

  const handleNullToggleClick = () => {
    handleToggleNull()
    queueMicrotask(() => {
      ignoreNextBlurRef.current = false
    })
  }

  const handleInternalControlMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      ignoreNextBlurRef.current = true
      stopEvent(event)
    },
    [ignoreNextBlurRef]
  )

  return { handleKeyDown, handleNullToggleClick, handleInternalControlMouseDown }
}

export function useJsonCellEditor(props: CellEditorBaseProps) {
  const state = useJsonValueState(props)
  const refs = useJsonEditorRefs()
  const monacoThemeName = useJsonEditorThemeName()
  useJsonEditorEffects(refs, monacoThemeName, state.isNull)
  const { commitValue, cancelEdit, syncToStore } = useJsonCommitActions(props, state, refs)
  const { handleToggleNull, handleChange } = useJsonEditActions(props, state, syncToStore)
  const handleBlur = useJsonBlurHandler(refs, commitValue)
  const handleEditorMount = useJsonEditorMount(refs, monacoThemeName, handleBlur)
  const controls = useJsonEditorControls(refs, { commitValue, cancelEdit, handleToggleNull })
  return {
    wrapperRef: refs.wrapperRef,
    isNull: state.isNull,
    value: state.value,
    monacoThemeName: monacoThemeName,
    handleChange: handleChange,
    handleEditorMount: handleEditorMount,
    ...controls,
  }
}
