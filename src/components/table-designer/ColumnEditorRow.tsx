import { DotsSixVertical } from '@phosphor-icons/react'
import type { CSSProperties } from 'react'
import { dataFlag } from '../../lib/data-attributes'
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
  isCellModified,
  stopClick,
  updateField,
} from './column-editor/column-cell-helpers'
import type { ColumnCellProps } from './column-editor/column-row-types'
import { columnRowClassName } from './column-editor/column-row-classes'
import { DefaultValueCell } from './column-editor/DefaultValueCell'
import {
  DesignerBodyCell,
  DesignerDeleteButton,
  DesignerRowAccent,
} from './designer-table/DesignerTableParts'
import { selectedAccent } from './designer-table/designer-accent'

export type {
  ColumnRowController,
  ColumnRowModel,
  DefaultCellControls,
} from './column-editor/column-row-types'

const SIGNEDNESS_DROPDOWN_OPTIONS: DropdownOption[] = [
  { value: 'SIGNED', label: 'Signed' },
  { value: 'UNSIGNED', label: 'Unsigned' },
]

const CELL_DROPDOWN_TRANSITION = 'transition-bg-and-color'

const TYPE_DROPDOWN_OPTIONS: DropdownOption[] = MYSQL_TYPES.map((type) => ({
  value: type.name,
  label: type.name,
  description: type.group,
}))

function dragRowStyle(drag: RowDrag | null, columnIndex: number): CSSProperties | undefined {
  if (!drag) return undefined
  const dragShift = dragShiftFor(drag, columnIndex)
  if (!dragShift) return undefined
  return { transform: `translateY(${dragShift * drag.rowHeight}px)` }
}

type TextCellInputProps = Pick<TextInputProps, 'invalid' | 'aria-invalid' | 'title' | 'disabled'>

interface TextCellLayout {
  frameClassName: string
  inputClassName: string
}

const TEXT_CELL_LAYOUTS: Record<TextCellKey, TextCellLayout> = {
  name: { frameClassName: 'w-37.5', inputClassName: 'font-mono' },
  length: { frameClassName: 'w-17.5', inputClassName: 'font-mono text-right' },
  comment: { frameClassName: 'w-42.5', inputClassName: '' },
}

interface TextColumnCellProps extends ColumnCellProps {
  cellKey: TextCellKey
  inputProps: TextCellInputProps
}

function TextColumnCell(props: TextColumnCellProps) {
  const { row, controller, cellKey, inputProps } = props
  const layout = TEXT_CELL_LAYOUTS[cellKey]
  const cell = cellOf(row, cellKey)
  const value = row.column[cellKey]
  const activateWithBaseline = () => {
    controller.activateCell(cell)
    controller.rememberEditStart(cell, value)
  }
  return (
    <DesignerBodyCell>
      <CellFrame
        modified={isCellModified(props, cellKey)}
        testId={`cell-${row.columnIndex}-${cellKey}`}
        className={layout.frameClassName}
      >
        <TextInput
          type="text"
          variant="tableCell"
          value={value}
          {...inputProps}
          className={layout.inputClassName}
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
    </DesignerBodyCell>
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
    <DesignerBodyCell>
      <CellFrame
        modified={isCellModified(props, 'type')}
        testId={`cell-${row.columnIndex}-type`}
        className="w-32.5"
      >
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
            triggerSize="cell"
            triggerClassName={CELL_DROPDOWN_TRANSITION}
          />
        </div>
      </CellFrame>
    </DesignerBodyCell>
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
    <DesignerBodyCell>
      <CellFrame
        modified={isCellModified(props, 'typeModifier')}
        testId={`cell-${row.columnIndex}-signedness`}
        className="w-29.5"
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
          triggerSize="cell"
          triggerClassName={CELL_DROPDOWN_TRANSITION}
        />
      </CellFrame>
    </DesignerBodyCell>
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
    <DesignerBodyCell className="w-16 text-center">
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
    </DesignerBodyCell>
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

function RowNumberCell({ columnIndex, isSelected }: { columnIndex: number; isSelected: boolean }) {
  return (
    <DesignerBodyCell className="w-9 text-center text-light-outline tabular-nums dark:text-dark-outline">
      <DesignerRowAccent accent={selectedAccent(isSelected)} />
      <span className="group-hover/row:invisible">{columnIndex + 1}</span>
      <span
        className="absolute inset-0 flex items-center justify-center text-light-on-surface-variant opacity-0 transition-opacity group-hover/row:opacity-90 dark:text-dark-on-surface-variant"
        aria-hidden
      >
        <DotsSixVertical size={16} weight="bold" />
      </span>
    </DesignerBodyCell>
  )
}

function DeleteCell({ row, controller }: ColumnCellProps) {
  const { column, columnIndex } = row
  return (
    <DesignerBodyCell className="w-10.5">
      <DesignerDeleteButton
        label={`Delete column ${column.name || columnIndex + 1}`}
        testId={`column-delete-${columnIndex}`}
        onDelete={() => controller.deleteColumn(columnIndex)}
      />
    </DesignerBodyCell>
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
      className={columnRowClassName({
        isSelected: row.isSelected,
        isDragging: drag !== null,
        isDragSource: isDragSource,
      })}
      style={dragRowStyle(drag, columnIndex)}
      data-selected={dataFlag(row.isSelected)}
      data-testid={`column-row-${columnIndex}`}
      onClick={() => handlers.onRowClick(columnIndex)}
      onPointerDown={(event) => handlers.onPointerDown(event, columnIndex)}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    >
      <RowNumberCell columnIndex={columnIndex} isSelected={row.isSelected} />
      <TextColumnCell {...cellProps} cellKey="name" inputProps={nameInputProps(nameError)} />
      <TypeCell {...cellProps} />
      <TextColumnCell
        {...cellProps}
        cellKey="length"
        inputProps={{ disabled: isTypeWithoutLength(column.type) }}
      />
      <SignednessCell {...cellProps} />
      <ColumnFlagCells {...cellProps} />
      <DefaultValueCell {...cellProps} />
      <TextColumnCell {...cellProps} cellKey="comment" inputProps={{}} />
      <DeleteCell {...cellProps} />
    </tr>
  )
}
