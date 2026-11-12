import { Plus, Trash } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import {
  useTableDesignerStore,
  type TableDesignerTabState,
} from '../../stores/table-designer-store'
import type { TableDesignerIndexDef } from '../../types/schema'
import { Button } from '../common/Button'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import styles from './IndexEditor.module.css'
import { isEven } from '../../lib/units'

const MAX_LISTED_COLUMN_LABELS = 2
const FIRST_SECONDARY_INDEX_ROW_NUMBER = 2

const INDEX_TYPE_DROPDOWN_OPTIONS: DropdownOption[] = [
  { value: 'UNIQUE', label: 'UNIQUE' },
  { value: 'INDEX', label: 'INDEX' },
  { value: 'FULLTEXT', label: 'FULLTEXT' },
]

interface IndexEditorProps {
  tabId: string
}

type SelectedRow = 'primary' | number | null

interface VisibleIndexRow {
  index: TableDesignerIndexDef
  storeIndex: number
}

function formatSelectedColumnsSummary(selectedOptions: DropdownOption[]): string {
  const count = selectedOptions.length
  if (count <= 0) {
    return 'Select columns'
  }
  if (count <= MAX_LISTED_COLUMN_LABELS) {
    return selectedOptions.map((option) => option.label).join(', ')
  }
  return `${count} selected`
}

function derivePrimaryIndex(tabState: TableDesignerTabState): TableDesignerIndexDef {
  const primaryColumns = tabState.currentSchema.columns
    .filter((column) => column.isPrimaryKey)
    .map((column) => column.name)
    .filter((name) => name !== '')

  return {
    name: 'PRIMARY',
    indexType: 'PRIMARY',
    columns: primaryColumns,
  }
}

function cloneComparable(value: unknown): string {
  return JSON.stringify(value)
}

function isNewIndex(tabState: TableDesignerTabState, index: TableDesignerIndexDef): boolean {
  if (tabState.mode !== 'alter') return false
  if (!tabState.originalSchema) return false

  const originalIndexes = tabState.originalSchema.indexes.filter(
    (originalIndex) => originalIndex.indexType !== 'PRIMARY'
  )

  return !originalIndexes.some(
    (originalIndex) =>
      originalIndex.name === index.name || cloneComparable(originalIndex) === cloneComparable(index)
  )
}

interface IndexRowPosition {
  storeIndex: number
  visibleIndex: number
  isSelected: boolean
  isNew: boolean
}

interface IndexRowContext {
  tabId: string
  columnNames: string[]
  validationErrors: Record<string, string>
  updateIndex: (
    tabId: string,
    indexPosition: number,
    field: keyof TableDesignerIndexDef,
    value: unknown
  ) => void
  onSelect: (storeIndex: number) => void
  onDelete: (storeIndex: number) => void
}

interface IndexRowProps {
  index: TableDesignerIndexDef
  position: IndexRowPosition
  context: IndexRowContext
}

function indexRowStripeClassName(isSelected: boolean, displayIndex: number): string {
  if (isSelected) return styles.selectedRow
  return isEven(displayIndex) ? styles.evenRow : styles.oddRow
}

function indexInputClassName(isSelected: boolean): string {
  return isSelected ? styles.activeInput : styles.inactiveInput
}

function errorClassName(error: string | undefined): string {
  return error ? styles.inputError : ''
}

function ariaInvalidFor(error: string | undefined): 'true' | 'false' {
  return error ? 'true' : 'false'
}

function stopRowSelection(event: React.MouseEvent): void {
  event.stopPropagation()
}

function FieldError({ error, testId }: { error: string | undefined; testId: string }) {
  if (!error) return null
  return (
    <div className={styles.errorText} data-testid={testId}>
      {error}
    </div>
  )
}

interface IndexColumnsSelectorProps {
  index: TableDesignerIndexDef
  position: IndexRowPosition
  context: IndexRowContext
  columnsError: string | undefined
}

function IndexColumnsSelector({
  index,
  position,
  context,
  columnsError,
}: IndexColumnsSelectorProps) {
  const { tabId, columnNames } = context
  const { storeIndex, visibleIndex } = position
  const selectRow = (event: React.MouseEvent) => {
    event.stopPropagation()
    context.onSelect(storeIndex)
  }

  if (columnNames.length === 0) {
    return (
      <Button
        type="button"
        className={`${styles.columnButton} ${errorClassName(columnsError)}`}
        aria-invalid={ariaInvalidFor(columnsError)}
        title={columnsError}
        data-testid={`index-columns-button-${visibleIndex}`}
        onClick={selectRow}
      >
        Add columns first
      </Button>
    )
  }

  const isColumnListSummarized = index.columns.length > MAX_LISTED_COLUMN_LABELS
  const summaryClassName = isColumnListSummarized ? styles.columnButtonSummary : ''
  return (
    <Dropdown
      id={`index-columns-${tabId}-${visibleIndex}`}
      ariaLabel="Index columns"
      listAriaLabel="Index columns"
      options={columnNames.map((columnName) => ({
        value: columnName,
        label: columnName,
      }))}
      multiple
      value={index.columns}
      data-testid={`index-columns-button-${visibleIndex}`}
      closeOnSelect={false}
      focusListOnOpen={false}
      renderTriggerValue={formatSelectedColumnsSummary}
      renderOptionLabel={(option) => <span>{option.label}</span>}
      triggerClassName={`${styles.columnButton} ${styles.columnButtonFixed} ${summaryClassName} ${errorClassName(columnsError)}`}
      triggerProps={{
        'aria-invalid': ariaInvalidFor(columnsError),
        title: columnsError,
        onClick: selectRow,
      }}
      onChange={(nextColumns) => {
        context.updateIndex(
          tabId,
          storeIndex,
          'columns',
          columnNames.filter((name) => nextColumns.includes(name))
        )
      }}
    />
  )
}

function IndexRow({ index, position, context }: IndexRowProps) {
  const { tabId } = context
  const { storeIndex, visibleIndex, isSelected } = position
  const displayIndex = visibleIndex + FIRST_SECONDARY_INDEX_ROW_NUMBER
  const nameError = context.validationErrors[`indexes.${storeIndex}.name`]
  const columnsError = context.validationErrors[`indexes.${storeIndex}.columns`]
  const newRowClassName = position.isNew ? styles.newRow : ''

  return (
    <tr
      className={`${styles.row} ${indexRowStripeClassName(isSelected, displayIndex)} ${newRowClassName}`}
      data-testid={`index-row-${visibleIndex}`}
      onClick={() => context.onSelect(storeIndex)}
    >
      <td className={`${styles.bodyCell} ${styles.indicatorCell}`}>
        <span className={styles.rowAccent} aria-hidden />
      </td>
      <td className={`${styles.bodyCell} ${styles.rowNumberCell}`}>{displayIndex}</td>
      <td className={styles.bodyCell}>
        <TextInput
          type="text"
          variant="tableCell"
          value={index.name}
          invalid={!!nameError}
          className={indexInputClassName(isSelected)}
          aria-invalid={ariaInvalidFor(nameError)}
          title={nameError}
          data-testid={`index-name-${visibleIndex}`}
          onClick={stopRowSelection}
          onChange={(event) => context.updateIndex(tabId, storeIndex, 'name', event.target.value)}
        />
        <FieldError error={nameError} testId={`index-name-error-${visibleIndex}`} />
      </td>
      <td className={styles.bodyCell}>
        <div onClick={stopRowSelection}>
          <Dropdown
            id={`index-type-${tabId}-${visibleIndex}`}
            ariaLabel="Index type"
            options={INDEX_TYPE_DROPDOWN_OPTIONS}
            value={index.indexType}
            data-testid={`index-type-${visibleIndex}`}
            onChange={(value) =>
              context.updateIndex(
                tabId,
                storeIndex,
                'indexType',
                value as TableDesignerIndexDef['indexType']
              )
            }
            triggerClassName={`${styles.cellSelect} ${indexInputClassName(isSelected)}`}
          />
        </div>
      </td>
      <td className={styles.bodyCell}>
        <div className={styles.columnSelector} onClick={stopRowSelection}>
          <IndexColumnsSelector
            index={index}
            position={position}
            context={context}
            columnsError={columnsError}
          />
        </div>
        <FieldError error={columnsError} testId={`index-columns-error-${visibleIndex}`} />
      </td>
      <td className={`${styles.bodyCell} ${styles.deleteCell}`}>
        <Button
          variant="subtle"
          size="sm"
          dangerText
          iconOnly
          aria-label={`Delete index ${index.name || visibleIndex + 1}`}
          data-testid={`index-delete-${visibleIndex}`}
          onClick={(event) => {
            event.stopPropagation()
            context.onDelete(storeIndex)
          }}
        >
          <Trash size={14} weight="bold" />
        </Button>
      </td>
    </tr>
  )
}

export function IndexEditor({ tabId }: IndexEditorProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const addIndex = useTableDesignerStore((state) => state.addIndex)
  const deleteIndex = useTableDesignerStore((state) => state.deleteIndex)
  const updateIndex = useTableDesignerStore((state) => state.updateIndex)

  const [selectedRow, setSelectedRow] = useState<SelectedRow>(null)

  const columns = useMemo(
    () => tabState?.currentSchema.columns ?? [],
    [tabState?.currentSchema.columns]
  )
  const columnNames = useMemo(
    () => columns.map((column) => column.name).filter((name) => name.trim() !== ''),
    [columns]
  )

  const visibleIndexes = useMemo<VisibleIndexRow[]>(() => {
    if (!tabState) {
      return []
    }

    return tabState.currentSchema.indexes
      .map((index, storeIndex) => ({ index, storeIndex }))
      .filter(({ index }) => index.indexType !== 'PRIMARY')
  }, [tabState])

  const primaryIndex = useMemo(() => {
    if (!tabState) {
      return null
    }

    return derivePrimaryIndex(tabState)
  }, [tabState])

  const effectiveSelectedRow = useMemo<SelectedRow>(() => {
    if (selectedRow === null) return selectedRow
    if (selectedRow === 'primary') return selectedRow

    return visibleIndexes.some(({ storeIndex }) => storeIndex === selectedRow) ? selectedRow : null
  }, [selectedRow, visibleIndexes])

  if (!tabState) return null
  if (!primaryIndex) return null

  const canDeleteSelected =
    effectiveSelectedRow !== null &&
    effectiveSelectedRow !== 'primary' &&
    visibleIndexes.some(({ storeIndex }) => storeIndex === effectiveSelectedRow)

  const handleDelete = (storeIndex: number) => {
    deleteIndex(tabId, storeIndex)
    setSelectedRow((current) => (current === storeIndex ? null : current))
  }

  const rowContext: IndexRowContext = {
    tabId: tabId,
    columnNames: columnNames,
    validationErrors: tabState.validationErrors,
    updateIndex: updateIndex,
    onSelect: setSelectedRow,
    onDelete: handleDelete,
  }

  return (
    <div className={styles.container} data-testid="index-editor">
      <div className={styles.toolbar}>
        <Button
          size="sm"
          onClick={() => {
            addIndex(tabId)
            const nextStoreIndex = tabState.currentSchema.indexes.length
            setSelectedRow(nextStoreIndex)
          }}
          data-testid="index-editor-add"
        >
          <Plus size={16} weight="regular" />
          <span>Add index</span>
        </Button>
        <span className={styles.toolbarDivider} aria-hidden />
        <Button
          variant="subtle"
          size="sm"
          dangerText
          onClick={() => {
            if (typeof selectedRow === 'number') {
              handleDelete(selectedRow)
            }
          }}
          disabled={!canDeleteSelected}
          data-testid="index-editor-delete-selected"
        >
          <Trash size={16} weight="regular" />
          <span>Delete selected</span>
        </Button>
      </div>

      <div className={styles.gridCard}>
        <div className={styles.tableScroller}>
          <table className={styles.table}>
            <thead className={styles.tableHead}>
              <tr>
                {['', '#', 'Name', 'Type', 'Columns', ''].map((label, index) => (
                  <th key={`${label}-${index}`} className={styles.headerCell} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={styles.tableBody}>
              <tr
                className={`${styles.row} ${effectiveSelectedRow === 'primary' ? styles.selectedRow : styles.evenRow}`}
                data-testid="index-row-primary"
                onClick={() => setSelectedRow('primary')}
              >
                <td className={`${styles.bodyCell} ${styles.indicatorCell}`}>
                  <span className={styles.rowAccent} aria-hidden />
                </td>
                <td className={`${styles.bodyCell} ${styles.rowNumberCell}`}>1</td>
                <td className={styles.bodyCell} data-testid="index-primary-name">
                  <span className={styles.readonlyText}>PRIMARY</span>
                </td>
                <td className={styles.bodyCell} data-testid="index-primary-type">
                  <span className={styles.readonlyText}>PRIMARY</span>
                </td>
                <td className={styles.bodyCell} data-testid="index-primary-columns">
                  <span className={styles.readonlyText}>
                    {primaryIndex.columns.join(', ') || '—'}
                  </span>
                </td>
                <td className={`${styles.bodyCell} ${styles.deleteCell}`} />
              </tr>

              {visibleIndexes.map(({ index, storeIndex }, visibleIndex) => (
                <IndexRow
                  key={`index-${storeIndex}`}
                  index={index}
                  position={{
                    storeIndex: storeIndex,
                    visibleIndex: visibleIndex,
                    isSelected: effectiveSelectedRow === storeIndex,
                    isNew: isNewIndex(tabState, index),
                  }}
                  context={rowContext}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
