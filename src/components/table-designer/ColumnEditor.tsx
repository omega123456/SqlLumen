import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  DotsSixVertical,
  PlusCircle,
  Trash,
} from '@phosphor-icons/react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { DefaultValueModel, TableDesignerColumnDef } from '../../types/schema'
import {
  useTableDesignerStore,
  type TableDesignerTabState,
} from '../../stores/table-designer-store'
import { Button } from '../common/Button'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { Checkbox } from '../common/Checkbox'
import {
  MYSQL_TYPES,
  getSignednessValue,
  normalizeTypeModifier,
  NUMERIC_TYPES,
  supportsSignedness,
  TYPES_WITHOUT_LENGTH,
} from './table-designer-type-constants'
import styles from './ColumnEditor.module.css'

interface ColumnEditorProps {
  tabId: string
}

const TYPES_WITHOUT_LENGTH_SET = new Set(TYPES_WITHOUT_LENGTH)
const NUMERIC_TYPE_SET = new Set(NUMERIC_TYPES)

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

type ColumnFieldKey = keyof Pick<
  TableDesignerColumnDef,
  | 'name'
  | 'type'
  | 'typeModifier'
  | 'length'
  | 'nullable'
  | 'isPrimaryKey'
  | 'isAutoIncrement'
  | 'defaultValue'
  | 'comment'
>

type EditableCellKey = 'name' | 'type' | 'length' | 'signedness' | 'default' | 'comment'

interface ActiveCell {
  rowIndex: number
  cellKey: EditableCellKey
}

const EDITABLE_CELL_ORDER: EditableCellKey[] = [
  'name',
  'type',
  'length',
  'signedness',
  'default',
  'comment',
]

function isTypeWithoutLength(type: string): boolean {
  return TYPES_WITHOUT_LENGTH_SET.has(type.toUpperCase())
}

function isNumericType(type: string): boolean {
  return NUMERIC_TYPE_SET.has(type.trim().toUpperCase())
}

function stripSignedness(modifier: string | null | undefined): string {
  return (modifier ?? '')
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '' && token.toUpperCase() !== 'UNSIGNED')
    .join(' ')
}

function applySignedness(
  modifier: string | null | undefined,
  nextSignedness: 'SIGNED' | 'UNSIGNED'
): string {
  const preserved = stripSignedness(modifier)
  return nextSignedness === 'UNSIGNED'
    ? ['UNSIGNED', preserved].filter(Boolean).join(' ')
    : preserved
}

function cloneComparable(value: unknown): string {
  return JSON.stringify(value)
}

function findOriginalColumn(
  tabState: TableDesignerTabState,
  column: TableDesignerColumnDef
): TableDesignerColumnDef | null {
  if (tabState.mode !== 'alter' || !tabState.originalSchema) {
    return null
  }

  const originalKey = column.originalName || column.name
  if (!originalKey) {
    return null
  }

  return (
    tabState.originalSchema.columns.find(
      (originalColumn) =>
        originalColumn.name === originalKey || originalColumn.originalName === originalKey
    ) ?? null
  )
}

function isModifiedCell(
  tabState: TableDesignerTabState,
  column: TableDesignerColumnDef,
  field: ColumnFieldKey
): boolean {
  const originalColumn = findOriginalColumn(tabState, column)
  if (!originalColumn) {
    return tabState.mode === 'alter'
  }

  if (field === 'typeModifier') {
    return (
      normalizeTypeModifier(column.type, column.typeModifier) !==
      normalizeTypeModifier(originalColumn.type, originalColumn.typeModifier)
    )
  }

  return cloneComparable(column[field]) !== cloneComparable(originalColumn[field])
}

function getSelectionAfterReorder(
  selectedIndex: number | null,
  fromIndex: number,
  toIndex: number
): number | null {
  if (selectedIndex === null) {
    return null
  }

  if (selectedIndex === fromIndex) {
    return toIndex
  }

  if (fromIndex < toIndex && selectedIndex > fromIndex && selectedIndex <= toIndex) {
    return selectedIndex - 1
  }

  if (fromIndex > toIndex && selectedIndex >= toIndex && selectedIndex < fromIndex) {
    return selectedIndex + 1
  }

  return selectedIndex
}

function CellFrame({
  modified,
  testId,
  children,
}: {
  modified: boolean
  testId: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.cellFrame} data-testid={testId}>
      {modified && (
        <span className={styles.modifiedTriangle} aria-hidden data-testid={`${testId}-modified`} />
      )}
      {children}
    </div>
  )
}

export function ColumnEditor({ tabId }: ColumnEditorProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const addColumn = useTableDesignerStore((state) => state.addColumn)
  const deleteColumn = useTableDesignerStore((state) => state.deleteColumn)
  const reorderColumn = useTableDesignerStore((state) => state.reorderColumn)
  const updateColumn = useTableDesignerStore((state) => state.updateColumn)

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [defaultModeOverrideIndex, setDefaultModeOverrideIndex] = useState<number | null>(null)
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null)
  const [pendingFocusCell, setPendingFocusCell] = useState<ActiveCell | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const editStartValuesRef = useRef<Record<string, string>>({})
  const defaultOverrideTriggerRef = useRef<HTMLButtonElement | null>(null)
  const defaultCellBlurTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const defaultOverrideOpenedRef = useRef(false)

  const columns = tabState?.currentSchema.columns ?? []
  const validationErrors = tabState?.validationErrors ?? {}

  const effectiveSelectedIndex = useMemo(() => {
    if (selectedIndex === null || columns.length === 0) {
      return null
    }

    return Math.min(selectedIndex, columns.length - 1)
  }, [columns.length, selectedIndex])

  const canMoveUp = effectiveSelectedIndex !== null && effectiveSelectedIndex > 0
  const canMoveDown = effectiveSelectedIndex !== null && effectiveSelectedIndex < columns.length - 1
  const canDelete = effectiveSelectedIndex !== null && effectiveSelectedIndex < columns.length

  const headerCells = useMemo(
    () => [
      '',
      '#',
      'Name',
      'Type',
      'Length',
      'Signed',
      'Nullable',
      'PK',
      'AI',
      'Default',
      'Comment',
      '',
    ],
    []
  )

  const getCellSelector = (rowIndex: number, cellKey: EditableCellKey) =>
    `[data-row-index="${rowIndex}"][data-cell-key="${cellKey}"]`

  const getCellElement = (rowIndex: number, cellKey: EditableCellKey) =>
    containerRef.current?.querySelector<HTMLElement>(getCellSelector(rowIndex, cellKey)) ?? null

  const isCellFocusable = (rowIndex: number, cellKey: EditableCellKey) => {
    const element = getCellElement(rowIndex, cellKey)
    if (!element) {
      return false
    }

    if (
      (element instanceof HTMLInputElement ||
        element instanceof HTMLButtonElement ||
        element instanceof HTMLSelectElement) &&
      element.disabled
    ) {
      return false
    }

    return true
  }

  const focusCell = (target: ActiveCell) => {
    const element = getCellElement(target.rowIndex, target.cellKey)
    if (!element) {
      setPendingFocusCell(target)
      return
    }

    element.focus()
    if (element instanceof HTMLInputElement && element.type !== 'checkbox') {
      element.select()
    }
  }

  const findAdjacentCell = (
    rowIndex: number,
    cellKey: EditableCellKey,
    direction: -1 | 1
  ): ActiveCell | null => {
    const currentCellIndex = EDITABLE_CELL_ORDER.indexOf(cellKey)
    if (currentCellIndex === -1) {
      return null
    }

    for (
      let absoluteIndex = rowIndex * EDITABLE_CELL_ORDER.length + currentCellIndex + direction;
      absoluteIndex >= 0;
      absoluteIndex += direction
    ) {
      const nextRowIndex = Math.floor(absoluteIndex / EDITABLE_CELL_ORDER.length)
      const nextCellIndex = absoluteIndex % EDITABLE_CELL_ORDER.length

      if (nextRowIndex < 0 || nextRowIndex >= columns.length) {
        break
      }

      const nextCellKey = EDITABLE_CELL_ORDER[nextCellIndex]
      if (!nextCellKey) {
        continue
      }

      if (isCellFocusable(nextRowIndex, nextCellKey)) {
        return { rowIndex: nextRowIndex, cellKey: nextCellKey }
      }
    }

    return null
  }

  const findSameCellInNextRow = (rowIndex: number, cellKey: EditableCellKey): ActiveCell | null => {
    for (let nextRowIndex = rowIndex + 1; nextRowIndex < columns.length; nextRowIndex += 1) {
      if (isCellFocusable(nextRowIndex, cellKey)) {
        return { rowIndex: nextRowIndex, cellKey }
      }
    }

    return null
  }

  const setEditStartValue = (rowIndex: number, cellKey: EditableCellKey, value: string) => {
    editStartValuesRef.current[`${rowIndex}:${cellKey}`] = value
  }

  const clearEditStartValue = (rowIndex: number, cellKey: EditableCellKey) => {
    delete editStartValuesRef.current[`${rowIndex}:${cellKey}`]
  }

  const scheduleDefaultCellBlur = (columnIndex: number) => {
    const timer = setTimeout(() => {
      clearEditStartValue(columnIndex, 'default')
      defaultCellBlurTimersRef.current.delete(columnIndex)
    }, 0)
    defaultCellBlurTimersRef.current.set(columnIndex, timer)
  }

  const cancelDefaultCellBlur = (columnIndex: number) => {
    const timer = defaultCellBlurTimersRef.current.get(columnIndex)
    if (timer !== undefined) {
      clearTimeout(timer)
      defaultCellBlurTimersRef.current.delete(columnIndex)
    }
  }

  const revertEditableField = (rowIndex: number, cellKey: EditableCellKey) => {
    const originalValue = editStartValuesRef.current[`${rowIndex}:${cellKey}`]
    if (originalValue === undefined) {
      return
    }

    switch (cellKey) {
      case 'name':
        updateColumn(tabId, rowIndex, 'name', originalValue)
        break
      case 'length':
        updateColumn(tabId, rowIndex, 'length', originalValue)
        break
      case 'signedness':
        updateColumn(tabId, rowIndex, 'typeModifier', originalValue)
        break
      case 'comment':
        updateColumn(tabId, rowIndex, 'comment', originalValue)
        break
      case 'default': {
        const baseline = JSON.parse(originalValue) as DefaultValueModel
        updateColumn(tabId, rowIndex, 'defaultValue', baseline)
        break
      }
      default:
        break
    }

    clearEditStartValue(rowIndex, cellKey)
  }

  const handleEditableKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    rowIndex: number,
    cellKey: EditableCellKey
  ) => {
    if (event.key === 'Tab') {
      event.preventDefault()
      clearEditStartValue(rowIndex, cellKey)

      const nextCell = findAdjacentCell(rowIndex, cellKey, event.shiftKey ? -1 : 1)
      if (nextCell) {
        ;(event.currentTarget as HTMLElement).blur()
        focusCell(nextCell)
        return
      }

      if (!event.shiftKey && rowIndex === columns.length - 1 && cellKey === 'comment') {
        addColumn(tabId)
        ;(event.currentTarget as HTMLElement).blur()
        setPendingFocusCell({ rowIndex: columns.length, cellKey: 'name' })
      }

      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      clearEditStartValue(rowIndex, cellKey)
      ;(event.currentTarget as HTMLElement).blur()

      const nextRowCell = findSameCellInNextRow(rowIndex, cellKey)
      if (nextRowCell) {
        focusCell(nextRowCell)
      }

      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      revertEditableField(rowIndex, cellKey)
      ;(event.currentTarget as HTMLElement).blur()
    }
  }

  useEffect(() => {
    if (!pendingFocusCell) {
      return
    }

    const handle = requestAnimationFrame(() => {
      focusCell(pendingFocusCell)
      setPendingFocusCell(null)
    })

    return () => {
      cancelAnimationFrame(handle)
    }
  }, [columns.length, pendingFocusCell])

  useEffect(() => {
    if (defaultModeOverrideIndex !== null) {
      defaultOverrideOpenedRef.current = false
      const raf = requestAnimationFrame(() => {
        const trigger = defaultOverrideTriggerRef.current
        if (trigger) {
          trigger.focus()
          trigger.click()
        }
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [defaultModeOverrideIndex])

  useEffect(() => {
    const timers = defaultCellBlurTimersRef.current
    return () => {
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [])

  if (!tabState) {
    return null
  }

  // Returns true if this cell is currently in active edit mode
  const isActiveCellFn = (rowIndex: number, cellKey: string) =>
    activeCell?.rowIndex === rowIndex && activeCell?.cellKey === cellKey

  // Returns the CSS class (active or inactive) for a cell input
  const getCellInputClass = (rowIndex: number, cellKey: string) =>
    isActiveCellFn(rowIndex, cellKey) ? styles.activeInput : styles.inactiveInput

  const handleAddColumn = () => {
    addColumn(tabId)
    setSelectedIndex(columns.length)
  }

  const handleDeleteAtIndex = (columnIndex: number) => {
    cancelDefaultCellBlur(columnIndex)
    defaultCellBlurTimersRef.current.forEach(clearTimeout)
    defaultCellBlurTimersRef.current.clear()
    deleteColumn(tabId, columnIndex)
    setDefaultModeOverrideIndex((current) => (current === columnIndex ? null : current))

    setSelectedIndex((current) => {
      if (current === null) {
        return null
      }

      if (current === columnIndex) {
        return columnIndex > 0 ? columnIndex - 1 : null
      }

      if (current > columnIndex) {
        return current - 1
      }

      return current
    })
  }

  const handleMoveSelected = (direction: -1 | 1) => {
    if (effectiveSelectedIndex === null) {
      return
    }

    const nextIndex = effectiveSelectedIndex + direction
    reorderColumn(tabId, effectiveSelectedIndex, nextIndex)
    setSelectedIndex(nextIndex)
  }

  return (
    <div className={styles.container} data-testid="column-editor" ref={containerRef}>
      <div className={styles.toolbar}>
        <Button
          type="button"
          variant="secondary"
          onClick={handleAddColumn}
          data-testid="column-editor-add"
        >
          <PlusCircle size={16} weight="bold" />
          <span>Add Column</span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleMoveSelected(-1)}
          disabled={!canMoveUp}
          data-testid="column-editor-move-up"
        >
          <ArrowUp size={16} weight="bold" />
          <span>Move Up</span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleMoveSelected(1)}
          disabled={!canMoveDown}
          data-testid="column-editor-move-down"
        >
          <ArrowDown size={16} weight="bold" />
          <span>Move Down</span>
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => {
            if (effectiveSelectedIndex !== null) {
              handleDeleteAtIndex(effectiveSelectedIndex)
            }
          }}
          disabled={!canDelete}
          data-testid="column-editor-delete"
        >
          <Trash size={16} weight="bold" />
          <span>Delete</span>
        </Button>
      </div>

      <div className={styles.tableScroller} data-testid="column-editor-scroller">
        <table className={styles.table}>
          <thead className={styles.tableHead}>
            <tr>
              {headerCells.map((label, index) => (
                <th key={`${label}-${index}`} className={styles.headerCell} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={styles.tableBody}>
            {columns.map((column, columnIndex) => {
              const nameError = validationErrors[`columns.${columnIndex}.name`]
              const isSelected = effectiveSelectedIndex === columnIndex
              const lengthDisabled = isTypeWithoutLength(column.type)
              const signednessDisabled = !supportsSignedness(column.type)
              const autoIncrementEnabled = column.isPrimaryKey && isNumericType(column.type)
              const signednessValue = getSignednessValue(column.type, column.typeModifier)

              const isDefaultOverride = defaultModeOverrideIndex === columnIndex
              const defaultMode = column.defaultValue.tag
              const defaultText = 'value' in column.defaultValue ? column.defaultValue.value : ''
              const showDefaultDropdown =
                isDefaultOverride || defaultMode === 'NO_DEFAULT' || defaultMode === 'NULL_DEFAULT'

              const captureDefaultBaseline = () => {
                cancelDefaultCellBlur(columnIndex)
                const key = `${columnIndex}:default`
                if (editStartValuesRef.current[key] === undefined) {
                  setEditStartValue(columnIndex, 'default', JSON.stringify(column.defaultValue))
                }
              }

              const applyDefaultModeChange = (nextMode: string) => {
                let newDefault: DefaultValueModel
                if (nextMode === 'NO_DEFAULT') newDefault = { tag: 'NO_DEFAULT' }
                else if (nextMode === 'NULL_DEFAULT') newDefault = { tag: 'NULL_DEFAULT' }
                else if (nextMode === 'LITERAL') newDefault = { tag: 'LITERAL', value: defaultText }
                else newDefault = { tag: 'EXPRESSION', value: defaultText }
                setDefaultModeOverrideIndex(null)
                updateColumn(tabId, columnIndex, 'defaultValue', newDefault)
                if (nextMode === 'LITERAL' || nextMode === 'EXPRESSION') {
                  setPendingFocusCell({ rowIndex: columnIndex, cellKey: 'default' })
                }
              }

              return (
                <tr
                  key={`${column.originalName || 'new'}-${columnIndex}`}
                  className={`${styles.row} ${isSelected ? styles.selectedRow : ''}`}
                  data-testid={`column-row-${columnIndex}`}
                  draggable={true}
                  onClick={() => setSelectedIndex(columnIndex)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', String(columnIndex))
                    setDragIndex(columnIndex)
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const fromIndex = dragIndex ?? Number(event.dataTransfer.getData('text/plain'))
                    if (Number.isNaN(fromIndex) || fromIndex === columnIndex) {
                      setDragIndex(null)
                      return
                    }

                    reorderColumn(tabId, fromIndex, columnIndex)
                    setSelectedIndex((current) =>
                      getSelectionAfterReorder(current, fromIndex, columnIndex)
                    )
                    setDragIndex(null)
                  }}
                >
                  <td className={`${styles.bodyCell} ${styles.dragCell}`}>
                    <span className={styles.rowAccent} aria-hidden />
                    <span className={styles.dragHandle} aria-hidden>
                      <DotsSixVertical size={16} weight="bold" />
                    </span>
                  </td>
                  <td className={`${styles.bodyCell} ${styles.rowNumberCell}`}>
                    {columnIndex + 1}
                  </td>
                  <td className={styles.bodyCell}>
                    <CellFrame
                      modified={isModifiedCell(tabState, column, 'name')}
                      testId={`cell-${columnIndex}-name`}
                    >
                      <TextInput
                        type="text"
                        variant="tableCell"
                        value={column.name}
                        invalid={!!nameError}
                        className={
                          isSelected ? styles.activeInput : getCellInputClass(columnIndex, 'name')
                        }
                        aria-invalid={nameError ? 'true' : 'false'}
                        title={nameError}
                        data-row-index={columnIndex}
                        data-cell-key="name"
                        data-testid={`column-name-${columnIndex}`}
                        onFocus={() => {
                          setSelectedIndex(columnIndex)
                          setActiveCell({ rowIndex: columnIndex, cellKey: 'name' })
                          setEditStartValue(columnIndex, 'name', column.name)
                        }}
                        onBlur={() => clearEditStartValue(columnIndex, 'name')}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => handleEditableKeyDown(event, columnIndex, 'name')}
                        onChange={(event) =>
                          updateColumn(tabId, columnIndex, 'name', event.target.value)
                        }
                      />
                    </CellFrame>
                  </td>
                  <td className={styles.bodyCell}>
                    <CellFrame
                      modified={isModifiedCell(tabState, column, 'type')}
                      testId={`cell-${columnIndex}-type`}
                    >
                      <div onClick={(event) => event.stopPropagation()}>
                        <Dropdown
                          id={`column-type-${tabId}-${columnIndex}`}
                          ariaLabel="MySQL type"
                          options={TYPE_DROPDOWN_OPTIONS}
                          value={column.type}
                          data-testid={`column-type-${columnIndex}`}
                          focusListOnOpen={false}
                          triggerProps={{
                            'data-row-index': columnIndex,
                            'data-cell-key': 'type',
                            onClick: (event) => {
                              event.stopPropagation()
                            },
                          }}
                          onChange={(nextType) => {
                            updateColumn(tabId, columnIndex, 'type', nextType)
                            if (
                              column.isAutoIncrement &&
                              (!isNumericType(nextType) || !column.isPrimaryKey)
                            ) {
                              updateColumn(tabId, columnIndex, 'isAutoIncrement', false)
                            }
                          }}
                          onTriggerFocus={() => {
                            setSelectedIndex(columnIndex)
                            setActiveCell({ rowIndex: columnIndex, cellKey: 'type' })
                          }}
                          onTriggerKeyDown={(event) =>
                            handleEditableKeyDown(event, columnIndex, 'type')
                          }
                          triggerClassName={`${styles.cellInput} ${styles.selectInput} ${
                            isSelected ? styles.activeInput : styles.inactiveInput
                          } ${styles.typeSelectInput}`}
                        />
                      </div>
                    </CellFrame>
                  </td>
                  <td className={styles.bodyCell}>
                    <CellFrame
                      modified={isModifiedCell(tabState, column, 'length')}
                      testId={`cell-${columnIndex}-length`}
                    >
                      <TextInput
                        type="text"
                        variant="tableCell"
                        value={column.length}
                        disabled={lengthDisabled}
                        className={`${
                          isSelected ? styles.activeInput : getCellInputClass(columnIndex, 'length')
                        } ${styles.lengthInput}`}
                        data-row-index={columnIndex}
                        data-cell-key="length"
                        data-testid={`column-length-${columnIndex}`}
                        onFocus={() => {
                          setSelectedIndex(columnIndex)
                          setActiveCell({ rowIndex: columnIndex, cellKey: 'length' })
                          setEditStartValue(columnIndex, 'length', column.length)
                        }}
                        onBlur={() => clearEditStartValue(columnIndex, 'length')}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => handleEditableKeyDown(event, columnIndex, 'length')}
                        onChange={(event) =>
                          updateColumn(tabId, columnIndex, 'length', event.target.value)
                        }
                      />
                    </CellFrame>
                  </td>
                  <td className={styles.bodyCell}>
                    <CellFrame
                      modified={isModifiedCell(tabState, column, 'typeModifier')}
                      testId={`cell-${columnIndex}-signedness`}
                    >
                      <Dropdown
                        id={`column-signedness-${tabId}-${columnIndex}`}
                        ariaLabel="Signedness"
                        options={SIGNEDNESS_DROPDOWN_OPTIONS}
                        value={signednessValue}
                        disabled={signednessDisabled}
                        data-testid={`column-signedness-${columnIndex}`}
                        triggerProps={{
                          'data-row-index': columnIndex,
                          'data-cell-key': 'signedness',
                          onClick: (event) => {
                            event.stopPropagation()
                          },
                        }}
                        onChange={(v) => {
                          const nextSignedness = v === 'UNSIGNED' ? 'UNSIGNED' : 'SIGNED'
                          updateColumn(
                            tabId,
                            columnIndex,
                            'typeModifier',
                            applySignedness(column.typeModifier, nextSignedness)
                          )
                        }}
                        onTriggerFocus={() => {
                          setSelectedIndex(columnIndex)
                          setActiveCell({ rowIndex: columnIndex, cellKey: 'signedness' })
                          setEditStartValue(columnIndex, 'signedness', column.typeModifier ?? '')
                        }}
                        onTriggerBlur={() => clearEditStartValue(columnIndex, 'signedness')}
                        onTriggerKeyDown={(event) =>
                          handleEditableKeyDown(event, columnIndex, 'signedness')
                        }
                        triggerClassName={`${styles.cellInput} ${styles.selectInput} ${
                          isSelected ? styles.activeInput : styles.inactiveInput
                        }`}
                      />
                    </CellFrame>
                  </td>
                  <td className={`${styles.bodyCell} ${styles.checkboxCell}`}>
                    <CellFrame
                      modified={isModifiedCell(tabState, column, 'nullable')}
                      testId={`cell-${columnIndex}-nullable`}
                    >
                      <Checkbox
                        checked={column.nullable}
                        data-testid={`column-nullable-${columnIndex}`}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          updateColumn(tabId, columnIndex, 'nullable', event.target.checked)
                        }}
                      />
                    </CellFrame>
                  </td>
                  <td className={`${styles.bodyCell} ${styles.checkboxCell}`}>
                    <CellFrame
                      modified={isModifiedCell(tabState, column, 'isPrimaryKey')}
                      testId={`cell-${columnIndex}-pk`}
                    >
                      <Checkbox
                        checked={column.isPrimaryKey}
                        data-testid={`column-pk-${columnIndex}`}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          const checked = event.target.checked
                          updateColumn(tabId, columnIndex, 'isPrimaryKey', checked)
                          if (checked) {
                            updateColumn(tabId, columnIndex, 'nullable', false)
                          } else if (column.isAutoIncrement) {
                            updateColumn(tabId, columnIndex, 'isAutoIncrement', false)
                          }
                        }}
                      />
                    </CellFrame>
                  </td>
                  <td className={`${styles.bodyCell} ${styles.checkboxCell}`}>
                    <CellFrame
                      modified={isModifiedCell(tabState, column, 'isAutoIncrement')}
                      testId={`cell-${columnIndex}-ai`}
                    >
                      <Checkbox
                        checked={column.isAutoIncrement}
                        disabled={!autoIncrementEnabled}
                        data-testid={`column-ai-${columnIndex}`}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          updateColumn(tabId, columnIndex, 'isAutoIncrement', event.target.checked)
                        }}
                      />
                    </CellFrame>
                  </td>
                  <td className={styles.bodyCell}>
                    <CellFrame
                      modified={isModifiedCell(tabState, column, 'defaultValue')}
                      testId={`cell-${columnIndex}-defaultValue`}
                    >
                      <div
                        className={styles.defaultValueCell}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {showDefaultDropdown ? (
                          <Dropdown
                            id={`column-default-${tabId}-${columnIndex}`}
                            ariaLabel="Default value"
                            options={DEFAULT_MODE_OPTIONS}
                            value={defaultMode}
                            focusListOnOpen={false}
                            data-testid={`column-default-${columnIndex}`}
                            triggerProps={{
                              'data-row-index': columnIndex,
                              'data-cell-key': 'default',
                              onClick: (event) => {
                                event.stopPropagation()
                              },
                            }}
                            triggerClassName={`${styles.cellInput} ${styles.selectInput} ${
                              isSelected ? styles.activeInput : styles.inactiveInput
                            }`}
                            onTriggerFocus={() => {
                              captureDefaultBaseline()
                              setSelectedIndex(columnIndex)
                              setActiveCell({ rowIndex: columnIndex, cellKey: 'default' })
                            }}
                            onTriggerBlur={() => scheduleDefaultCellBlur(columnIndex)}
                            onTriggerKeyDown={(event) => {
                              if (isDefaultOverride) {
                                if (event.key === 'Tab' || event.key === 'Escape') {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  setDefaultModeOverrideIndex(null)
                                  setPendingFocusCell({
                                    rowIndex: columnIndex,
                                    cellKey: 'default',
                                  })
                                  return
                                }
                              }
                              handleEditableKeyDown(event, columnIndex, 'default')
                            }}
                            onChange={applyDefaultModeChange}
                            onOpenChange={
                              isDefaultOverride
                                ? (open: boolean) => {
                                    if (open) {
                                      defaultOverrideOpenedRef.current = true
                                    } else if (defaultOverrideOpenedRef.current) {
                                      setDefaultModeOverrideIndex(null)
                                    }
                                  }
                                : undefined
                            }
                            ref={isDefaultOverride ? defaultOverrideTriggerRef : undefined}
                          />
                        ) : (
                          <div className={styles.defaultValueInputContainer}>
                            <TextInput
                              type="text"
                              variant="tableCell"
                              value={defaultText}
                              data-testid={`column-default-input-${columnIndex}`}
                              data-row-index={columnIndex}
                              data-cell-key="default"
                              className={
                                isSelected
                                  ? styles.activeInput
                                  : getCellInputClass(columnIndex, 'default')
                              }
                              onFocus={() => {
                                captureDefaultBaseline()
                                setSelectedIndex(columnIndex)
                                setActiveCell({ rowIndex: columnIndex, cellKey: 'default' })
                              }}
                              onBlur={() => scheduleDefaultCellBlur(columnIndex)}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                updateColumn(tabId, columnIndex, 'defaultValue', {
                                  tag: defaultMode as 'LITERAL' | 'EXPRESSION',
                                  value: event.target.value,
                                })
                              }}
                              onKeyDown={(event) => {
                                if (event.altKey && event.key === 'ArrowDown') {
                                  event.preventDefault()
                                  setDefaultModeOverrideIndex(columnIndex)
                                  return
                                }
                                handleEditableKeyDown(event, columnIndex, 'default')
                              }}
                            />
                            <Button
                              variant="secondary"
                              tabIndex={-1}
                              aria-label="Change default mode"
                              data-testid={`column-default-mode-${columnIndex}`}
                              className={styles.defaultModeIconButton}
                              onClick={() => setDefaultModeOverrideIndex(columnIndex)}
                            >
                              <CaretDown size={16} weight="bold" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </CellFrame>
                  </td>
                  <td className={styles.bodyCell}>
                    <CellFrame
                      modified={isModifiedCell(tabState, column, 'comment')}
                      testId={`cell-${columnIndex}-comment`}
                    >
                      <TextInput
                        type="text"
                        variant="tableCell"
                        value={column.comment}
                        className={
                          isSelected
                            ? styles.activeInput
                            : getCellInputClass(columnIndex, 'comment')
                        }
                        data-row-index={columnIndex}
                        data-cell-key="comment"
                        data-testid={`column-comment-${columnIndex}`}
                        onFocus={() => {
                          setSelectedIndex(columnIndex)
                          setActiveCell({ rowIndex: columnIndex, cellKey: 'comment' })
                          setEditStartValue(columnIndex, 'comment', column.comment)
                        }}
                        onBlur={() => clearEditStartValue(columnIndex, 'comment')}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => handleEditableKeyDown(event, columnIndex, 'comment')}
                        onChange={(event) =>
                          updateColumn(tabId, columnIndex, 'comment', event.target.value)
                        }
                      />
                    </CellFrame>
                  </td>
                  <td className={`${styles.bodyCell} ${styles.deleteCell}`}>
                    <Button
                      variant="rowDelete"
                      aria-label={`Delete column ${column.name || columnIndex + 1}`}
                      data-testid={`column-delete-${columnIndex}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleDeleteAtIndex(columnIndex)
                      }}
                    >
                      <Trash size={14} weight="bold" />
                    </Button>
                  </td>
                </tr>
              )
            })}

            <tr
              className={styles.ghostRow}
              onClick={handleAddColumn}
              data-testid="column-editor-ghost-add"
            >
              <td className={styles.bodyCell}>+</td>
              <td className={styles.bodyCell} colSpan={11}>
                Click to add new column...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
