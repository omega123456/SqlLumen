import Editor from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { useEffect, useMemo, useRef } from 'react'
import { ElevatedCodePanel } from '../common/ElevatedCodePanel'
import { JsonSyntaxHighlighter } from '../../lib/json-syntax-highlighter'
import { getMonacoThemeName, registerMonacoThemes } from '../../lib/monaco-theme'
import { useThemeStore } from '../../stores/theme-store'
import styles from './JsonFormField.module.css'

function prettyPrintJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function normalizeJson(value: string): string | null {
  try {
    return JSON.stringify(JSON.parse(value))
  } catch {
    return null
  }
}

function toStringValue(value: string | null): string {
  return value ?? ''
}

function resolveChangedValue(originalValue: string, editorValue: string): string {
  const currentNormalized = normalizeJson(editorValue)
  const originalNormalized = normalizeJson(originalValue)

  if (currentNormalized !== null && currentNormalized === originalNormalized) {
    return originalValue
  }

  if (currentNormalized === null && editorValue === originalValue) {
    return originalValue
  }

  return editorValue
}

interface JsonFormFieldProps {
  value: string | null
  onChange: (value: string) => void
  isEditable: boolean
  isNull: boolean
  testId?: string
}

export function JsonFormField({
  value,
  onChange,
  isEditable,
  isNull,
  testId = 'json-form-field',
}: JsonFormFieldProps) {
  const theme = useThemeStore((state) => state.theme)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const monacoTheme = useMemo(
    () => getMonacoThemeName(theme, resolvedTheme === 'dark'),
    [resolvedTheme, theme]
  )

  const originalValue = toStringValue(value)
  const prettyValue = useMemo(
    () => (isNull ? '' : prettyPrintJson(originalValue)),
    [isNull, originalValue]
  )

  if (!isEditable) {
    if (isNull) {
      return (
        <div className={`${styles.field} ${styles.nullValue}`} data-testid={testId}>
          NULL
        </div>
      )
    }

    return (
      <div className={styles.field} data-testid={testId}>
        <ElevatedCodePanel
          hideHeader={true}
          className={styles.readPanel}
          bodyClassName={styles.readPanelBody}
          preClassName={styles.readPanelPre}
          codeClassName={styles.readPanelCode}
          data-testid={`${testId}-panel`}
        >
          {JsonSyntaxHighlighter.highlightJson(prettyValue, {
            key: styles.key,
            string: styles.string,
            number: styles.number,
            boolean: styles.boolean,
            null: styles.null,
            punctuation: styles.punctuation,
          })}
        </ElevatedCodePanel>
      </div>
    )
  }

  if (isNull) {
    return (
      <div className={`${styles.field} ${styles.nullValue}`} data-testid={testId}>
        NULL
      </div>
    )
  }

  return (
    <div className={styles.field} data-testid={testId}>
      <JsonFormFieldEditor
        externalValue={prettyValue}
        originalValue={originalValue}
        monacoTheme={monacoTheme}
        onChange={onChange}
      />
    </div>
  )
}

interface JsonFormFieldEditorProps {
  externalValue: string
  originalValue: string
  monacoTheme: ReturnType<typeof getMonacoThemeName>
  onChange: (value: string) => void
}

function JsonFormFieldEditor({
  externalValue,
  originalValue,
  monacoTheme,
  onChange,
}: JsonFormFieldEditorProps) {
  const draftValueRef = useRef(externalValue)
  const lastSyncedExternalValueRef = useRef(externalValue)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    if (!monacoRef.current) {
      return
    }

    monacoRef.current.editor.setTheme(monacoTheme)
  }, [monacoTheme])

  useEffect(() => {
    if (externalValue === lastSyncedExternalValueRef.current) {
      return
    }

    const currentNormalized = normalizeJson(draftValueRef.current)
    const nextNormalized = normalizeJson(externalValue)
    const shouldPreserveEditorValue =
      externalValue === draftValueRef.current ||
      (currentNormalized !== null &&
        nextNormalized !== null &&
        currentNormalized === nextNormalized)

    lastSyncedExternalValueRef.current = externalValue

    if (shouldPreserveEditorValue) {
      return
    }

    draftValueRef.current = externalValue
    if (editorRef.current && editorRef.current.getValue() !== externalValue) {
      editorRef.current.setValue(externalValue)
    }
  }, [externalValue])

  return (
    <div className={styles.editorShell}>
      <div className={styles.editorViewport}>
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
          }}
          onChange={(nextValue) => {
            draftValueRef.current = nextValue ?? ''
            onChange(resolveChangedValue(originalValue, draftValueRef.current))
          }}
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  )
}
