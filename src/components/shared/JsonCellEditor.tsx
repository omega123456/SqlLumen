import Editor from '@monaco-editor/react'
import { joinClassNames } from '../../lib/class-names'
import type { CellEditorBaseProps } from './grid-cell-editors'
import {
  JSON_EDITOR_OPTIONS,
  isMonacoInternalMouseTarget,
} from './json-cell-editor/json-cell-editor-values'
import { EditorMarkerGroup } from './grid-cell-editors/EditorMarkerGroup'
import { NullToggleButton } from './grid-cell-editors/NullToggleButton'
import { useJsonCellEditor } from './json-cell-editor/use-json-cell-editor'

type JsonSurfaceState = 'value' | 'null'

const JSON_SURFACE_FRAME =
  'h-full min-h-50 w-auto max-w-full min-w-0 flex-auto overflow-hidden rounded-control'

const JSON_SURFACE_CLASSES: Record<JsonSurfaceState, string> = {
  value: joinClassNames([JSON_SURFACE_FRAME, 'bg-light-surface dark:bg-dark-surface']),
  null: joinClassNames([
    JSON_SURFACE_FRAME,
    'flex items-center justify-center bg-light-surface p-3 whitespace-pre-wrap text-light-on-surface-variant dark:bg-dark-surface dark:text-dark-on-surface-variant',
  ]),
}

function preventMonacoInternalMouseDown(event: React.MouseEvent<HTMLDivElement>): void {
  if (isMonacoInternalMouseTarget(event.target)) {
    event.preventDefault()
  }
}

function jsonSurfaceState(isNull: boolean): JsonSurfaceState {
  if (isNull) return 'null'
  return 'value'
}

export default function JsonCellEditor(props: CellEditorBaseProps) {
  const isNullable = props.isNullable ?? false
  const editor = useJsonCellEditor(props)
  const { wrapperRef, isNull } = editor

  return (
    <div
      ref={wrapperRef}
      className="click-outside-ignore flex h-full min-h-50 w-full max-w-full min-w-0 flex-auto items-stretch gap-1 overflow-hidden"
      data-testid="json-cell-editor"
      onKeyDownCapture={editor.handleKeyDown}
      onMouseDownCapture={preventMonacoInternalMouseDown}
    >
      <div
        className={JSON_SURFACE_CLASSES[jsonSurfaceState(isNull)]}
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
      <EditorMarkerGroup kind="json">
        {isNullable ? (
          <NullToggleButton
            isNull={isNull}
            className="click-outside-ignore"
            onMouseDown={editor.handleInternalControlMouseDown}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              editor.handleNullToggleClick()
            }}
          />
        ) : null}
      </EditorMarkerGroup>
    </div>
  )
}
