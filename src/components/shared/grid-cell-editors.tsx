import { useRef } from 'react'
import { TextInput } from '../common/TextInput'
import { Textarea } from '../common/Textarea'
import { EditorMarkers } from './grid-cell-editors/EditorMarkers'
import type { CellEditorBaseProps } from './grid-cell-editors/cell-editor-types'
import { isMultilineCommitKey, isSingleLineCommitKey } from './grid-cell-editors/cell-editor-keys'
import { useNullableTextEditor } from './grid-cell-editors/use-nullable-text-editor'
import { CELL_EDITOR_WRAPPER, EDITOR_FIELD } from '../../lib/class-names-grid-editor'

export type { CellEditorBaseProps } from './grid-cell-editors/cell-editor-types'
export { EnumCellEditor } from './grid-cell-editors/EnumCellEditor'

export function NullableCellEditor(props: CellEditorBaseProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { isNull, displayValue, handleToggleNull, handleChange, handleBlur, handleKeyDown } =
    useNullableTextEditor(props, { fieldRef: inputRef, wrapperRef: wrapperRef })

  return (
    <div ref={wrapperRef} className={CELL_EDITOR_WRAPPER}>
      <div className={EDITOR_FIELD}>
        <TextInput
          ref={inputRef}
          variant="gridCell"
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
    <div
      ref={wrapperRef}
      className="flex h-full min-h-33 w-full max-w-full min-w-0 flex-auto items-stretch gap-1"
    >
      <div className="h-full w-auto max-w-full min-w-0 flex-auto overflow-hidden">
        <Textarea
          ref={textareaRef}
          variant="bare"
          className="h-full max-h-full min-h-33 w-full min-w-0 resize-none rounded-control bg-transparent px-2.5 py-2 leading-compact text-light-on-surface focus-visible:shadow-light-field-focus focus-visible:outline-none dark:text-dark-on-surface dark:focus-visible:shadow-dark-field-focus"
          rows={6}
          value={displayValue}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={(event) => handleBlur(event.relatedTarget)}
          onKeyDown={(event) => handleKeyDown(event, isMultilineCommitKey(event))}
        />
      </div>
      <EditorMarkers
        props={props}
        isNull={isNull}
        onToggleNull={handleToggleNull}
        kind="multiline"
      />
    </div>
  )
}
