import Editor from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { ElevatedCodePanel } from '../common/ElevatedCodePanel'
import { JsonSyntaxHighlighter } from '../../lib/json-syntax-highlighter'
import { isEquivalentJson, normalizeJson, prettyPrintJson } from '../../lib/json-text'
import { getMonacoThemeName, registerMonacoThemes } from '../../lib/monaco-theme'
import { useThemeStore } from '../../stores/theme-store'

function toStringValue(value: string | null): string {
  return value ?? ''
}

function resolveChangedValue(originalValue: string, editorValue: string): string {
  return isEquivalentJson(editorValue, originalValue) ? originalValue : editorValue
}

interface JsonFormFieldProps {
  value: string | null
  onChange: (value: string) => void
  isEditable: boolean
  isNull: boolean
  testId?: string
}

const JSON_HIGHLIGHT_CLASS_NAMES = {
  key: 'text-light-primary dark:text-dark-primary',
  string: 'text-light-tertiary dark:text-dark-tertiary',
  number: 'text-light-warning dark:text-dark-warning',
  boolean: 'text-light-secondary dark:text-dark-secondary',
  null: 'text-light-error dark:text-dark-error',
  punctuation: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
}

const JSON_FORM_EDITOR_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  contextmenu: false,
  quickSuggestions: false,
}

function useJsonFormMonacoTheme(): ReturnType<typeof getMonacoThemeName> {
  const theme = useThemeStore((state) => state.theme)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  return useMemo(() => getMonacoThemeName(theme, resolvedTheme === 'dark'), [resolvedTheme, theme])
}

function JsonNullValue({ testId }: { testId: string }) {
  return (
    <div
      className="min-w-0 flex-1 rounded-control border border-light-stroke-card bg-light-background px-3 py-2 font-mono text-size-mono text-light-on-surface-variant italic opacity-60 dark:border-dark-stroke-card dark:bg-dark-background dark:text-dark-on-surface-variant"
      data-testid={testId}
    >
      NULL
    </div>
  )
}

function JsonReadOnlyValue({ prettyValue, testId }: { prettyValue: string; testId: string }) {
  return (
    <div className="min-w-0 flex-1 opacity-60" data-testid={testId}>
      <ElevatedCodePanel
        hideHeader={true}
        preSpacing="snug"
        bodyClassName="max-h-75 overflow-y-auto"
        codeClassName="block"
        data-testid={`${testId}-panel`}
      >
        {JsonSyntaxHighlighter.highlightJson(prettyValue, JSON_HIGHLIGHT_CLASS_NAMES)}
      </ElevatedCodePanel>
    </div>
  )
}

export function JsonFormField({
  value,
  onChange,
  isEditable,
  isNull,
  testId = 'json-form-field',
}: JsonFormFieldProps) {
  const monacoTheme = useJsonFormMonacoTheme()
  const originalValue = toStringValue(value)
  const prettyValue = useMemo(
    () => (isNull ? '' : prettyPrintJson(originalValue)),
    [isNull, originalValue]
  )

  if (isNull) return <JsonNullValue testId={testId} />
  if (!isEditable) return <JsonReadOnlyValue prettyValue={prettyValue} testId={testId} />

  return (
    <div className="min-w-0 flex-1" data-testid={testId}>
      <JsonFormFieldEditor
        externalValue={prettyValue}
        originalValue={originalValue}
        monacoTheme={monacoTheme}
        onChange={onChange}
        testId={`${testId}-editor`}
      />
    </div>
  )
}

interface JsonFormFieldEditorProps {
  externalValue: string
  originalValue: string
  monacoTheme: ReturnType<typeof getMonacoThemeName>
  onChange: (value: string) => void
  testId?: string
}

interface ExternalJsonSync {
  externalValue: string
  draftValueRef: RefObject<string>
  editorRef: RefObject<Monaco.editor.IStandaloneCodeEditor | null>
}

function isSameJsonDocument(draftValue: string, externalValue: string): boolean {
  if (externalValue === draftValue) return true
  const currentNormalized = normalizeJson(draftValue)
  const nextNormalized = normalizeJson(externalValue)
  return (
    currentNormalized !== null && nextNormalized !== null && currentNormalized === nextNormalized
  )
}

function replaceDraftWithExternalValue(sync: ExternalJsonSync): void {
  const { externalValue, draftValueRef, editorRef } = sync
  draftValueRef.current = externalValue
  const editor = editorRef.current
  const isEditorOutOfSync = editor !== null && editor.getValue() !== externalValue
  if (isEditorOutOfSync) {
    editor.setValue(externalValue)
  }
}

function useSyncExternalJsonValue(sync: ExternalJsonSync): void {
  const { externalValue, draftValueRef, editorRef } = sync
  const lastSyncedExternalValueRef = useRef(externalValue)
  useEffect(() => {
    if (externalValue === lastSyncedExternalValueRef.current) return
    const shouldPreserveEditorValue = isSameJsonDocument(draftValueRef.current, externalValue)
    lastSyncedExternalValueRef.current = externalValue
    if (shouldPreserveEditorValue) return
    replaceDraftWithExternalValue({ externalValue, draftValueRef, editorRef })
  }, [draftValueRef, editorRef, externalValue])
}

function JsonFormFieldEditor({
  externalValue,
  originalValue,
  monacoTheme,
  onChange,
  testId,
}: JsonFormFieldEditorProps) {
  const draftValueRef = useRef(externalValue)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    if (!monacoRef.current) {
      return
    }

    monacoRef.current.editor.setTheme(monacoTheme)
  }, [monacoTheme])

  useSyncExternalJsonValue({ externalValue, draftValueRef, editorRef })

  return (
    <div
      className="max-h-75 overflow-hidden rounded-control border border-light-stroke-card bg-light-background dark:border-dark-stroke-card dark:bg-dark-background"
      data-testid={testId}
    >
      <div className="h-75">
        <Editor
          height="300px"
          defaultValue={externalValue}
          language="json"
          theme={monacoTheme}
          onMount={(editor, monaco) => {
            editorRef.current = editor
            monacoRef.current = monaco
            registerMonacoThemes(monaco)
            monaco.editor.setTheme(monacoTheme)
            editor.addCommand(monaco.KeyCode.F1, () => null)
          }}
          onChange={(nextValue) => {
            draftValueRef.current = nextValue ?? ''
            onChange(resolveChangedValue(originalValue, draftValueRef.current))
          }}
          options={JSON_FORM_EDITOR_OPTIONS}
        />
      </div>
    </div>
  )
}
