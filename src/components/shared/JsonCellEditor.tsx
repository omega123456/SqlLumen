import Editor from '@monaco-editor/react'
import type { CellEditorBaseProps } from './grid-cell-editors'
import {
  JSON_EDITOR_OPTIONS,
  isMonacoInternalMouseTarget,
} from './json-cell-editor/json-cell-editor-values'
import { NullToggleButton } from './json-cell-editor/NullToggleButton'
import { useJsonCellEditor } from './json-cell-editor/use-json-cell-editor'
import styles from './JsonCellEditor.module.css'

function preventMonacoInternalMouseDown(event: React.MouseEvent<HTMLDivElement>): void {
  if (isMonacoInternalMouseTarget(event.target)) {
    event.preventDefault()
  }
}

export default function JsonCellEditor(props: CellEditorBaseProps) {
  const isNullable = props.isNullable ?? false
  const editor = useJsonCellEditor(props)
  const { wrapperRef, isNull } = editor

  return (
    <div
      ref={wrapperRef}
      className={`${styles.editorWrapper} click-outside-ignore`}
      data-testid="json-cell-editor"
      onKeyDownCapture={editor.handleKeyDown}
      onMouseDownCapture={preventMonacoInternalMouseDown}
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
            value={editor.value}
            theme={editor.monacoThemeName}
            onMount={editor.handleEditorMount}
            onChange={(nextValue) => {
              editor.handleChange(nextValue ?? '')
            }}
            options={JSON_EDITOR_OPTIONS}
          />
        )}
      </div>
      <div className={styles.editorMarkerGroup}>
        {isNullable ? (
          <NullToggleButton
            isNull={isNull}
            onMouseDown={editor.handleInternalControlMouseDown}
            onToggle={editor.handleNullToggleClick}
          />
        ) : null}
      </div>
    </div>
  )
}
