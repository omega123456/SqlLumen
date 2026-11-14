import { CaretDown } from '@phosphor-icons/react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Button } from '../../common/Button'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import { defaultValueForMode, defaultValueText, isTextDefaultMode } from '../column-editor-model'
import { CellFrame } from './CellFrame'
import {
  cellOf,
  dropdownTriggerClass,
  editableInputClass,
  isCellModified,
  stopClick,
  updateField,
} from './column-cell-helpers'
import type { ColumnCellProps } from './column-row-types'
import styles from '../ColumnEditor.module.css'

const DEFAULT_MODE_OPTIONS: DropdownOption[] = [
  { value: 'NO_DEFAULT', label: 'No default' },
  { value: 'NULL_DEFAULT', label: 'NULL' },
  { value: 'LITERAL', label: 'Custom' },
  { value: 'EXPRESSION', label: 'Expression' },
]

const OVERRIDE_EXIT_KEYS = new Set(['Tab', 'Escape'])

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

export function DefaultValueCell(props: ColumnCellProps) {
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
