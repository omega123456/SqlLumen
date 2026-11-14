import { DotsSixVertical, Trash } from '@phosphor-icons/react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { Button } from '../common/Button'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { TextInput, type TextInputProps } from '../common/TextInput'
import { Checkbox } from '../common/Checkbox'
import {
  MYSQL_TYPES,
  getSignednessValue,
  supportsSignedness,
} from './table-designer-type-constants'
import {
  applySignedness,
  canAutoIncrement,
  dragShiftFor,
  isTypeWithoutLength,
  mustClearAutoIncrementForType,
  toSignedness,
  type RowDrag,
  type TextCellKey,
} from './column-editor-model'
import type { ColumnRowDragHandlers } from './useColumnRowDrag'
import { CellFrame } from './column-editor/CellFrame'
import {
  ariaInvalidValue,
  cellOf,
  dropdownTriggerClass,
  editableInputClass,
  isCellModified,
  stopClick,
  updateField,
} from './column-editor/column-cell-helpers'
import type { ColumnCellProps } from './column-editor/column-row-types'
import { DefaultValueCell } from './column-editor/DefaultValueCell'
import styles from './ColumnEditor.module.css'

export type {
  ColumnRowController,
  ColumnRowModel,
  DefaultCellControls,
} from './column-editor/column-row-types'

const SIGNEDNESS_DROPDOWN_OPTIONS: DropdownOption[] = [
  { value: 'SIGNED', label: 'Signed' },
  { value: 'UNSIGNED', label: 'Unsigned' },
]

const TYPE_DROPDOWN_OPTIONS: DropdownOption[] = MYSQL_TYPES.map((type) => ({
  value: type.name,
  label: type.name,
  description: type.group,
}))

function columnRowClassName(isSelected: boolean, isDragSource: boolean): string {
  return `${styles.row} ${isSelected ? styles.selectedRow : ''} ${
    isDragSource ? styles.dragSource : ''
  }`
}

function dragRowStyle(dragShift: number): CSSProperties | undefined {
  if (!dragShift) return undefined
  return { transform: `translateY(calc(${dragShift} * var(--drag-row-height)))` }
}

type TextCellInputProps = Pick<TextInputProps, 'invalid' | 'aria-invalid' | 'title' | 'disabled'>

interface TextColumnCellProps extends ColumnCellProps {
  cellKey: TextCellKey
  inputClassName: string
  inputProps: TextCellInputProps
}

function TextColumnCell(props: TextColumnCellProps) {
  const { row, controller, cellKey, inputClassName, inputProps } = props
  const cell = cellOf(row, cellKey)
  const value = row.column[cellKey]
  const activateWithBaseline = () => {
    controller.activateCell(cell)
    controller.rememberEditStart(cell, value)
  }
  return (
    <td className={styles.bodyCell}>
      <CellFrame
        modified={isCellModified(props, cellKey)}
        testId={`cell-${row.columnIndex}-${cellKey}`}
      >
        <TextInput
          type="text"
          variant="tableCell"
          value={value}
          {...inputProps}
          className={`${editableInputClass(row, controller.isActiveCell(cell))} ${inputClassName}`}
          data-row-index={row.columnIndex}
          data-cell-key={cellKey}
          data-testid={`column-${cellKey}-${row.columnIndex}`}
          onFocus={activateWithBaseline}
          onBlur={() => controller.forgetEditStart(cell)}
          onClick={stopClick}
          onKeyDown={(event) => controller.handleEditableKeyDown(event, cell)}
          onChange={(event) => updateField(props, cellKey, event.target.value)}
        />
      </CellFrame>
    </td>
  )
}

function changeColumnType(props: ColumnCellProps, nextType: string) {
  updateField(props, 'type', nextType)
  if (mustClearAutoIncrementForType(props.row.column, nextType)) {
    updateField(props, 'isAutoIncrement', false)
  }
}

function TypeCell(props: ColumnCellProps) {
  const { row, controller } = props
  const cell = cellOf(row, 'type')
  return (
    <td className={styles.bodyCell}>
      <CellFrame modified={isCellModified(props, 'type')} testId={`cell-${row.columnIndex}-type`}>
        <div onClick={stopClick}>
          <Dropdown
            id={`column-type-${controller.tabId}-${row.columnIndex}`}
            ariaLabel="MySQL type"
            options={TYPE_DROPDOWN_OPTIONS}
            value={row.column.type}
            data-testid={`column-type-${row.columnIndex}`}
            focusListOnOpen={false}
            triggerProps={{
              'data-row-index': row.columnIndex,
              'data-cell-key': 'type',
              onClick: stopClick,
            }}
            onChange={(nextType) => changeColumnType(props, nextType)}
            onTriggerFocus={() => controller.activateCell(cell)}
            onTriggerKeyDown={(event) => controller.handleEditableKeyDown(event, cell)}
            triggerClassName={dropdownTriggerClass(row, `${styles.cellInput} ${styles.typeInput}`)}
          />
        </div>
      </CellFrame>
    </td>
  )
}

function SignednessCell(props: ColumnCellProps) {
  const { row, controller } = props
  const { column } = row
  const cell = cellOf(row, 'signedness')
  const activateWithBaseline = () => {
    controller.activateCell(cell)
    controller.rememberEditStart(cell, column.typeModifier ?? '')
  }
  const changeSignedness = (value: string) => {
    const nextModifier = applySignedness(column.typeModifier, toSignedness(value))
    updateField(props, 'typeModifier', nextModifier)
  }
  return (
    <td className={styles.bodyCell}>
      <CellFrame
        modified={isCellModified(props, 'typeModifier')}
        testId={`cell-${row.columnIndex}-signedness`}
      >
        <Dropdown
          id={`column-signedness-${controller.tabId}-${row.columnIndex}`}
          ariaLabel="Signedness"
          options={SIGNEDNESS_DROPDOWN_OPTIONS}
          value={getSignednessValue(column.type, column.typeModifier)}
          disabled={!supportsSignedness(column.type)}
          data-testid={`column-signedness-${row.columnIndex}`}
          triggerProps={{
            'data-row-index': row.columnIndex,
            'data-cell-key': 'signedness',
            onClick: stopClick,
          }}
          onChange={changeSignedness}
          onTriggerFocus={activateWithBaseline}
          onTriggerBlur={() => controller.forgetEditStart(cell)}
          onTriggerKeyDown={(event) => controller.handleEditableKeyDown(event, cell)}
          triggerClassName={dropdownTriggerClass(row, `${styles.cellInput} ${styles.signedInput}`)}
        />
      </CellFrame>
    </td>
  )
}

type CheckboxField = 'nullable' | 'isPrimaryKey' | 'isAutoIncrement'

interface CheckboxColumnCellProps extends ColumnCellProps {
  field: CheckboxField
  testSuffix: string
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}

function CheckboxColumnCell(props: CheckboxColumnCellProps) {
  const { row, field, testSuffix, disabled, onCheckedChange } = props
  return (
    <td className={`${styles.bodyCell} ${styles.checkboxCell}`}>
      <CellFrame
        modified={isCellModified(props, field)}
        testId={`cell-${row.columnIndex}-${testSuffix}`}
      >
        <Checkbox
          checked={row.column[field]}
          disabled={disabled}
          data-testid={`column-${testSuffix}-${row.columnIndex}`}
          onClick={stopClick}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
      </CellFrame>
    </td>
  )
}

function changePrimaryKey(props: ColumnCellProps, checked: boolean) {
  updateField(props, 'isPrimaryKey', checked)
  if (checked) {
    updateField(props, 'nullable', false)
    return
  }
  if (props.row.column.isAutoIncrement) {
    updateField(props, 'isAutoIncrement', false)
  }
}

function RowNumberCell({ columnIndex }: { columnIndex: number }) {
  return (
    <td className={`${styles.bodyCell} ${styles.rowNumberCell}`}>
      <span className={styles.rowAccent} aria-hidden />
      <span className={styles.rowNumber}>{columnIndex + 1}</span>
      <span className={styles.dragHandle} aria-hidden>
        <DotsSixVertical size={16} weight="bold" />
      </span>
    </td>
  )
}

function DeleteCell({ row, controller }: ColumnCellProps) {
  const deleteLabel = `Delete column ${row.column.name || row.columnIndex + 1}`
  const deleteColumn = (event: ReactMouseEvent) => {
    event.stopPropagation()
    controller.deleteColumn(row.columnIndex)
  }
  return (
    <td className={`${styles.bodyCell} ${styles.deleteCell}`}>
      <Button
        variant="subtle"
        size="sm"
        dangerText
        iconOnly
        aria-label={deleteLabel}
        data-testid={`column-delete-${row.columnIndex}`}
        onClick={deleteColumn}
      >
        <Trash size={14} weight="bold" />
      </Button>
    </td>
  )
}

export interface ColumnRowDragProps {
  drag: RowDrag | null
  handlers: ColumnRowDragHandlers
}

interface ColumnRowProps extends ColumnCellProps {
  rowDrag: ColumnRowDragProps
}

function nameInputProps(nameError: string | undefined): TextCellInputProps {
  return {
    invalid: Boolean(nameError),
    'aria-invalid': ariaInvalidValue(nameError),
    title: nameError,
  }
}

function ColumnFlagCells(cellProps: ColumnCellProps) {
  const { column } = cellProps.row
  return (
    <>
      <CheckboxColumnCell
        {...cellProps}
        field="nullable"
        testSuffix="nullable"
        onCheckedChange={(checked) => updateField(cellProps, 'nullable', checked)}
      />
      <CheckboxColumnCell
        {...cellProps}
        field="isPrimaryKey"
        testSuffix="pk"
        onCheckedChange={(checked) => changePrimaryKey(cellProps, checked)}
      />
      <CheckboxColumnCell
        {...cellProps}
        field="isAutoIncrement"
        testSuffix="ai"
        disabled={!canAutoIncrement(column)}
        onCheckedChange={(checked) => updateField(cellProps, 'isAutoIncrement', checked)}
      />
    </>
  )
}

export function ColumnRow({ row, controller, rowDrag }: ColumnRowProps) {
  const { column, columnIndex } = row
  const { drag, handlers } = rowDrag
  const cellProps = { row: row, controller: controller }
  const nameError = controller.tabState.validationErrors[`columns.${columnIndex}.name`]
  const isDragSource = drag?.from === columnIndex
  return (
    <tr
      className={columnRowClassName(row.isSelected, isDragSource)}
      style={dragRowStyle(dragShiftFor(drag, columnIndex))}
      data-testid={`column-row-${columnIndex}`}
      onClick={() => handlers.onRowClick(columnIndex)}
      onPointerDown={(event) => handlers.onPointerDown(event, columnIndex)}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    >
      <RowNumberCell columnIndex={columnIndex} />
      <TextColumnCell
        {...cellProps}
        cellKey="name"
        inputClassName={styles.nameInput}
        inputProps={nameInputProps(nameError)}
      />
      <TypeCell {...cellProps} />
      <TextColumnCell
        {...cellProps}
        cellKey="length"
        inputClassName={styles.lengthInput}
        inputProps={{ disabled: isTypeWithoutLength(column.type) }}
      />
      <SignednessCell {...cellProps} />
      <ColumnFlagCells {...cellProps} />
      <DefaultValueCell {...cellProps} />
      <TextColumnCell
        {...cellProps}
        cellKey="comment"
        inputClassName={styles.commentInput}
        inputProps={{}}
      />
      <DeleteCell {...cellProps} />
    </tr>
  )
}
