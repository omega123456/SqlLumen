/**
 * Shared cell editor components for grid adapters.
 *
 * Both editors follow the shared declarative editor protocol:
 * - Accept { row, column, onRowChange, onClose } props
 * - Plus explicit callback props for store updates
 *
 * - NullableCellEditor: text input with optional NULL toggle
 * - EnumCellEditor: Dropdown with optional NULL toggle
 *
 * Also exports getCellEditorForColumn — a factory that selects the correct
 * editor (DateTimeCellEditor / EnumCellEditor / NullableCellEditor) based on
 * column metadata, used by both TableDataGrid and ResultGridView.
 */

import { useRef } from 'react'
import { TextInput } from '../common/TextInput'
import { Textarea } from '../common/Textarea'
import { EditorMarkers } from './grid-cell-editors/EditorMarkers'
import type { CellEditorBaseProps } from './grid-cell-editors/cell-editor-types'
import { isMultilineCommitKey, isSingleLineCommitKey } from './grid-cell-editors/cell-editor-keys'
import { useNullableTextEditor } from './grid-cell-editors/use-nullable-text-editor'
import styles from './grid-cell-editors.module.css'

export type { CellEditorBaseProps } from './grid-cell-editors/cell-editor-types'
export { EnumCellEditor } from './grid-cell-editors/EnumCellEditor'

export function NullableCellEditor(props: CellEditorBaseProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { isNull, displayValue, handleToggleNull, handleChange, handleBlur, handleKeyDown } =
    useNullableTextEditor(props, { fieldRef: inputRef, wrapperRef: wrapperRef })

  return (
    <div ref={wrapperRef} className={styles.cellEditorWrapper}>
      <div className={styles.editorFieldPrimary}>
        <TextInput
          ref={inputRef}
          variant="gridCell"
          className={styles.editorInput}
          value={displayValue}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={(event) => handleBlur(event.relatedTarget)}
          onKeyDown={(event) => handleKeyDown(event, isSingleLineCommitKey(event))}
        />
      </div>
      <EditorMarkers props={props} isNull={isNull} onToggleNull={handleToggleNull} />
    </div>
  )
}

export function NullableMultilineCellEditor(props: CellEditorBaseProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { isNull, displayValue, handleToggleNull, handleChange, handleBlur, handleKeyDown } =
    useNullableTextEditor(props, { fieldRef: textareaRef, wrapperRef: wrapperRef })

  return (
    <div ref={wrapperRef} className={styles.multilineEditorWrapper}>
      <div className={styles.multilineEditorField}>
        <Textarea
          ref={textareaRef}
          variant="bare"
          className={styles.editorTextarea}
          rows={6}
          value={displayValue}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={(event) => handleBlur(event.relatedTarget)}
          onKeyDown={(event) => handleKeyDown(event, isMultilineCommitKey(event))}
        />
      </div>
      <EditorMarkers props={props} isNull={isNull} onToggleNull={handleToggleNull} />
    </div>
  )
}
