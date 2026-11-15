import { CaretDown } from '@phosphor-icons/react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { joinClassNames } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'
import { Button } from '../../common/Button'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import { defaultValueForMode, defaultValueText, isTextDefaultMode } from '../column-editor-model'
import { CellFrame } from './CellFrame'
import { cellOf, isCellModified, stopClick, updateField } from './column-cell-helpers'
import type { ColumnCellProps } from './column-row-types'
import { DesignerBodyCell } from '../designer-table/DesignerTableParts'

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
      triggerSize="cell"
      triggerClassName="transition-bg-and-color"
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
    <div className="flex w-full min-w-0 items-center gap-1">
      <TextInput
        type="text"
        variant="tableCell"
        value={defaultValueText(column.defaultValue)}
        data-testid={`column-default-input-${columnIndex}`}
        data-row-index={columnIndex}
        data-cell-key="default"
        className="min-w-0 flex-1 font-mono"
        onFocus={activate}
        onBlur={() => defaultCell.scheduleBlur(columnIndex)}
        onClick={stopClick}
        onChange={(event) => changeText(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Button
        variant="bare"
        tabIndex={-1}
        aria-label="Change default mode"
        data-testid={`column-default-mode-${columnIndex}`}
        className={joinClassNames([
          'inline-flex size-7 shrink-0 cursor-default items-center justify-center gap-2 rounded-control border border-x-light-stroke-control border-t-light-stroke-control border-b-light-stroke-control-bottom bg-transparent p-1 font-body text-body font-regular whitespace-nowrap text-light-on-surface-variant hover:bg-light-surface-container-highest dark:border-x-dark-stroke-control dark:border-t-dark-stroke-control dark:border-b-dark-stroke-control-bottom dark:text-dark-on-surface-variant dark:hover:bg-dark-surface-container-highest',
          FOCUS_RING,
        ])}
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
    <DesignerBodyCell>
      <CellFrame
        modified={isCellModified(props, 'defaultValue')}
        testId={`cell-${row.columnIndex}-defaultValue`}
      >
        <div className="relative flex w-42.5 items-center gap-2" onClick={stopClick}>
          {showsDefaultModeDropdown(props) ? (
            <DefaultModeDropdown {...props} />
          ) : (
            <DefaultTextInput {...props} />
          )}
        </div>
      </CellFrame>
    </DesignerBodyCell>
  )
}
