import { CaretDown, DotsSixVertical, Trash } from '@phosphor-icons/react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from 'react'
import type { DefaultValueModel, TableDesignerColumnDef } from '../../types/schema'
import type { DesignerFieldEdit, TableDesignerTabState } from '../../stores/table-designer-store'
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
  defaultValueForMode,
  defaultValueText,
  dragShiftFor,
  isModifiedCell,
  isTextDefaultMode,
  isTypeWithoutLength,
  mustClearAutoIncrementForType,
  toSignedness,
  type ActiveCell,
  type ColumnFieldKey,
  type EditableCellKey,
  type RowDrag,
  type TextCellKey,
} from './column-editor-model'
import type { ColumnRowDragHandlers } from './useColumnRowDrag'
import styles from './ColumnEditor.module.css'

const SIGNEDNESS_DROPDOWN_OPTIONS: DropdownOption[] = [
  { value: 'SIGNED', label: 'Signed' },
  { value: 'UNSIGNED', label: 'Unsigned' },
]

const TYPE_DROPDOWN_OPTIONS: DropdownOption[] = MYSQL_TYPES.map((type) => ({
  value: type.name,
  label: type.name,
  description: type.group,
}))

const DEFAULT_MODE_OPTIONS: DropdownOption[] = [
  { value: 'NO_DEFAULT', label: 'No default' },
  { value: 'NULL_DEFAULT', label: 'NULL' },
  { value: 'LITERAL', label: 'Custom' },
  { value: 'EXPRESSION', label: 'Expression' },
]

const OVERRIDE_EXIT_KEYS = new Set(['Tab', 'Escape'])

export interface DefaultCellControls {
  overrideIndex: number | null
  overrideTriggerRef: RefObject<HTMLButtonElement | null>
  captureBaseline: (columnIndex: number, defaultValue: DefaultValueModel) => void
  scheduleBlur: (columnIndex: number) => void
  openOverride: (columnIndex: number) => void
  closeOverride: () => void
  handleOverrideOpenChange: (open: boolean) => void
}

export interface ColumnRowController {
  tabId: string
  tabState: TableDesignerTabState
  updateColumn: (edit: DesignerFieldEdit<TableDesignerColumnDef>) => void
  activateCell: (cell: ActiveCell) => void
  focusCellLater: (cell: ActiveCell) => void
  rememberEditStart: (cell: ActiveCell, value: string) => void
  forgetEditStart: (cell: ActiveCell) => void
  handleEditableKeyDown: (event: ReactKeyboardEvent<HTMLElement>, cell: ActiveCell) => void
  isActiveCell: (cell: ActiveCell) => boolean
  deleteColumn: (columnIndex: number) => void
  defaultCell: DefaultCellControls
}

export interface ColumnRowModel {
  column: TableDesignerColumnDef
  columnIndex: number
  isSelected: boolean
}

interface ColumnCellProps {
  row: ColumnRowModel
  controller: ColumnRowController
}

function stopClick(event: ReactMouseEvent) {
  event.stopPropagation()
}

function cellOf(row: ColumnRowModel, cellKey: EditableCellKey): ActiveCell {
  return { rowIndex: row.columnIndex, cellKey: cellKey }
}

function selectedRowInputClass(isSelected: boolean, unselectedClass: string): string {
  return isSelected ? styles.activeInput : unselectedClass
}

function editableInputClass(row: ColumnRowModel, isActive: boolean): string {
  const activityClass = isActive ? styles.activeInput : styles.inactiveInput
  return selectedRowInputClass(row.isSelected, activityClass)
}

function dropdownTriggerClass(row: ColumnRowModel, cellClasses: string): string {
  return `${cellClasses} ${selectedRowInputClass(row.isSelected, styles.inactiveInput)}`
}

function updateField(
  { row, controller }: ColumnCellProps,
  field: keyof TableDesignerColumnDef,
  value: unknown
) {
  controller.updateColumn({ index: row.columnIndex, field: field, value: value })
}

function isCellModified({ row, controller }: ColumnCellProps, field: ColumnFieldKey): boolean {
  return isModifiedCell(controller.tabState, row.column, field)
}

function columnRowClassName(isSelected: boolean, isDragSource: boolean): string {
  return `${styles.row} ${isSelected ? styles.selectedRow : ''} ${
    isDragSource ? styles.dragSource : ''
  }`
}

function dragRowStyle(dragShift: number): CSSProperties | undefined {
  if (!dragShift) return undefined
  return { transform: `translateY(calc(${dragShift} * var(--drag-row-height)))` }
}

function ariaInvalidValue(error: string | undefined): 'true' | 'false' {
  return error ? 'true' : 'false'
}

interface CellFrameProps {
  modified: boolean
  testId: string
  children: ReactNode
}

function CellFrame({ modified, testId, children }: CellFrameProps) {
  return (
    <div className={styles.cellFrame} data-testid={testId}>
      {modified && (
        <span className={styles.modifiedTriangle} aria-hidden data-testid={`${testId}-modified`} />
      )}
      {children}
    </div>
  )
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

function DefaultModeDropdown(props: ColumnCellProps) {
  const { row, controller } = props
  const { defaultCell } = controller
  const { columnIndex } = row
  const cell = cellOf(row, 'default')
  const isOverride = defaultCell.overrideIndex === columnIndex
  const defaultText = defaultValueText(row.column.defaultValue)

  const activate = () => {
    defaultCell.captureBaseline(columnIndex, row.column.defaultValue)
    controller.activateCell(cell)
  }
  const changeMode = (nextMode: string) => {
    defaultCell.closeOverride()
    updateField(props, 'defaultValue', defaultValueForMode(nextMode, defaultText))
    if (isTextDefaultMode(nextMode)) {
      controller.focusCellLater(cell)
    }
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const exitsOverride = isOverride && OVERRIDE_EXIT_KEYS.has(event.key)
    if (exitsOverride) {
      event.preventDefault()
      event.stopPropagation()
      defaultCell.closeOverride()
      controller.focusCellLater(cell)
      return
    }
    controller.handleEditableKeyDown(event, cell)
  }

  return (
    <Dropdown
      id={`column-default-${controller.tabId}-${columnIndex}`}
      ariaLabel="Default value"
      options={DEFAULT_MODE_OPTIONS}
      value={row.column.defaultValue.tag}
      focusListOnOpen={false}
      data-testid={`column-default-${columnIndex}`}
      triggerProps={{
        'data-row-index': columnIndex,
        'data-cell-key': 'default',
        onClick: stopClick,
      }}
      triggerClassName={dropdownTriggerClass(row, styles.cellInput)}
      onTriggerFocus={activate}
      onTriggerBlur={() => defaultCell.scheduleBlur(columnIndex)}
      onTriggerKeyDown={handleKeyDown}
      onChange={changeMode}
      onOpenChange={isOverride ? defaultCell.handleOverrideOpenChange : undefined}
      ref={isOverride ? defaultCell.overrideTriggerRef : undefined}
    />
  )
}

function isDefaultModeShortcut(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return event.altKey && event.key === 'ArrowDown'
}

function DefaultTextInput(props: ColumnCellProps) {
  const { row, controller } = props
  const { defaultCell } = controller
  const { column, columnIndex } = row
  const cell = cellOf(row, 'default')

  const activate = () => {
    defaultCell.captureBaseline(columnIndex, column.defaultValue)
    controller.activateCell(cell)
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (isDefaultModeShortcut(event)) {
      event.preventDefault()
      defaultCell.openOverride(columnIndex)
      return
    }
    controller.handleEditableKeyDown(event, cell)
  }
  const changeText = (text: string) => {
    updateField(props, 'defaultValue', { tag: column.defaultValue.tag, value: text })
  }

  return (
    <div className={styles.defaultValueInputContainer}>
      <TextInput
        type="text"
        variant="tableCell"
        value={defaultValueText(column.defaultValue)}
        data-testid={`column-default-input-${columnIndex}`}
        data-row-index={columnIndex}
        data-cell-key="default"
        className={editableInputClass(row, controller.isActiveCell(cell))}
        onFocus={activate}
        onBlur={() => defaultCell.scheduleBlur(columnIndex)}
        onClick={stopClick}
        onChange={(event) => changeText(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Button
        tabIndex={-1}
        aria-label="Change default mode"
        data-testid={`column-default-mode-${columnIndex}`}
        className={styles.defaultModeIconButton}
        onClick={() => defaultCell.openOverride(columnIndex)}
      >
        <CaretDown size={16} weight="bold" />
      </Button>
    </div>
  )
}

function showsDefaultModeDropdown(props: ColumnCellProps): boolean {
  const isOverride = props.controller.defaultCell.overrideIndex === props.row.columnIndex
  if (isOverride) return true
  return !isTextDefaultMode(props.row.column.defaultValue.tag)
}

function DefaultValueCell(props: ColumnCellProps) {
  const { row } = props
  return (
    <td className={styles.bodyCell}>
      <CellFrame
        modified={isCellModified(props, 'defaultValue')}
        testId={`cell-${row.columnIndex}-defaultValue`}
      >
        <div className={styles.defaultValueCell} onClick={stopClick}>
          {showsDefaultModeDropdown(props) ? (
            <DefaultModeDropdown {...props} />
          ) : (
            <DefaultTextInput {...props} />
          )}
        </div>
      </CellFrame>
    </td>
  )
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
