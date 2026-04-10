import { PlusCircle, Trash } from '@phosphor-icons/react'
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
  if (count <= 2) {
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
  if (tabState.mode !== 'alter' || !tabState.originalSchema) {
    return false
  }

  const originalIndexes = tabState.originalSchema.indexes.filter(
    (originalIndex) => originalIndex.indexType !== 'PRIMARY'
  )

  return !originalIndexes.some(
    (originalIndex) =>
      originalIndex.name === index.name || cloneComparable(originalIndex) === cloneComparable(index)
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
    if (selectedRow === null || selectedRow === 'primary') {
      return selectedRow
    }

    return visibleIndexes.some(({ storeIndex }) => storeIndex === selectedRow) ? selectedRow : null
  }, [selectedRow, visibleIndexes])

  if (!tabState || !primaryIndex) {
    return null
  }

  const canDeleteSelected =
    effectiveSelectedRow !== null &&
    effectiveSelectedRow !== 'primary' &&
    visibleIndexes.some(({ storeIndex }) => storeIndex === effectiveSelectedRow)

  const handleDelete = (storeIndex: number) => {
    deleteIndex(tabId, storeIndex)
    setSelectedRow((current) => (current === storeIndex ? null : current))
  }

  return (
    <div className={styles.container} data-testid="index-editor">
      <div className={styles.toolbar}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            addIndex(tabId)
            const nextStoreIndex = tabState.currentSchema.indexes.length
            setSelectedRow(nextStoreIndex)
          }}
          data-testid="index-editor-add"
        >
          <PlusCircle size={16} weight="bold" />
          <span>Add Index</span>
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => {
            if (typeof selectedRow === 'number') {
              handleDelete(selectedRow)
            }
          }}
          disabled={!canDeleteSelected}
          data-testid="index-editor-delete-selected"
        >
          <Trash size={16} weight="bold" />
          <span>Delete Selected</span>
        </Button>
      </div>

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

            {visibleIndexes.map(({ index, storeIndex }, visibleIndex) => {
              const displayIndex = visibleIndex + 2
              const isSelected = effectiveSelectedRow === storeIndex
              const newRow = isNewIndex(tabState, index)
              const nameError = tabState.validationErrors[`indexes.${storeIndex}.name`]
              const columnsError = tabState.validationErrors[`indexes.${storeIndex}.columns`]

              return (
                <tr
                  key={`index-${storeIndex}`}
                  className={`${styles.row} ${
                    isSelected
                      ? styles.selectedRow
                      : displayIndex % 2 === 0
                        ? styles.evenRow
                        : styles.oddRow
                  } ${newRow ? styles.newRow : ''}`}
                  data-testid={`index-row-${visibleIndex}`}
                  onClick={() => setSelectedRow(storeIndex)}
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
                      className={`${isSelected ? styles.activeInput : styles.inactiveInput}`}
                      aria-invalid={nameError ? 'true' : 'false'}
                      title={nameError}
                      data-testid={`index-name-${visibleIndex}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        updateIndex(tabId, storeIndex, 'name', event.target.value)
                      }
                    />
                    {nameError && (
                      <div
                        className={styles.errorText}
                        data-testid={`index-name-error-${visibleIndex}`}
                      >
                        {nameError}
                      </div>
                    )}
                  </td>
                  <td className={styles.bodyCell}>
                    <div onClick={(event) => event.stopPropagation()}>
                      <Dropdown
                        id={`index-type-${tabId}-${visibleIndex}`}
                        ariaLabel="Index type"
                        options={INDEX_TYPE_DROPDOWN_OPTIONS}
                        value={index.indexType}
                        data-testid={`index-type-${visibleIndex}`}
                        onChange={(v) =>
                          updateIndex(
                            tabId,
                            storeIndex,
                            'indexType',
                            v as TableDesignerIndexDef['indexType']
                          )
                        }
                        triggerClassName={`${styles.cellSelect} ${
                          isSelected ? styles.activeInput : styles.inactiveInput
                        }`}
                      />
                    </div>
                  </td>
                  <td className={styles.bodyCell}>
                    <div
                      className={styles.columnSelector}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {columnNames.length > 0 ? (
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
                          triggerClassName={`${styles.columnButton} ${
                            isSelected ? styles.activeColumnButton : styles.inactiveColumnButton
                          } ${styles.columnButtonFixed} ${
                            index.columns.length > 2 ? styles.columnButtonSummary : ''
                          } ${columnsError ? styles.inputError : ''}`}
                          triggerProps={{
                            'aria-invalid': columnsError ? 'true' : 'false',
                            title: columnsError,
                            onClick: (event) => {
                              event.stopPropagation()
                              setSelectedRow(storeIndex)
                            },
                          }}
                          onChange={(nextColumns) => {
                            updateIndex(
                              tabId,
                              storeIndex,
                              'columns',
                              columnNames.filter((name) => nextColumns.includes(name))
                            )
                          }}
                        />
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          className={`${styles.columnButton} ${
                            isSelected ? styles.activeColumnButton : styles.inactiveColumnButton
                          } ${columnsError ? styles.inputError : ''}`}
                          aria-invalid={columnsError ? 'true' : 'false'}
                          title={columnsError}
                          data-testid={`index-columns-button-${visibleIndex}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedRow(storeIndex)
                          }}
                        >
                          Add columns first
                        </Button>
                      )}
                    </div>
                    {columnsError && (
                      <div
                        className={styles.errorText}
                        data-testid={`index-columns-error-${visibleIndex}`}
                      >
                        {columnsError}
                      </div>
                    )}
                  </td>
                  <td className={`${styles.bodyCell} ${styles.deleteCell}`}>
                    <Button
                      variant="rowDelete"
                      aria-label={`Delete index ${index.name || visibleIndex + 1}`}
                      data-testid={`index-delete-${visibleIndex}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleDelete(storeIndex)
                      }}
                    >
                      <Trash size={14} weight="bold" />
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
