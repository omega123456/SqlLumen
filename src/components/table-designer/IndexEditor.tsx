import { Plus, Trash } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import {
  useTableDesignerStore,
  type TableDesignerTabState,
} from '../../stores/table-designer-store'
import type { TableDesignerIndexDef } from '../../types/schema'
import { Button } from '../common/Button'
import styles from './IndexEditor.module.css'
import { isBlank } from '../../lib/value-checks'
import {
  canDeleteSelectedIndex,
  derivePrimaryIndex,
  isNewIndex,
  resolveEffectiveSelectedRow,
  visibleIndexesOf,
  type IndexRowContext,
  type SelectedRow,
  type VisibleIndexRow,
} from './index-editor/index-editor-model'
import { IndexRow } from './index-editor/IndexRow'

interface IndexEditorProps {
  tabId: string
}

const INDEX_COLUMN_LABELS = ['', '#', 'Name', 'Type', 'Columns', '']

interface IndexToolbarProps {
  canDeleteSelected: boolean
  onAdd: () => void
  onDeleteSelected: () => void
}

function IndexToolbar({ canDeleteSelected, onAdd, onDeleteSelected }: IndexToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <Button size="sm" onClick={onAdd} data-testid="index-editor-add">
        <Plus size={16} weight="regular" />
        <span>Add index</span>
      </Button>
      <span className={styles.toolbarDivider} aria-hidden />
      <Button
        variant="subtle"
        size="sm"
        dangerText
        onClick={onDeleteSelected}
        disabled={!canDeleteSelected}
        data-testid="index-editor-delete-selected"
      >
        <Trash size={16} weight="regular" />
        <span>Delete selected</span>
      </Button>
    </div>
  )
}

interface PrimaryIndexRowProps {
  primaryIndex: TableDesignerIndexDef
  isSelected: boolean
  onSelect: () => void
}

function PrimaryIndexRow({ primaryIndex, isSelected, onSelect }: PrimaryIndexRowProps) {
  return (
    <tr
      className={`${styles.row} ${isSelected ? styles.selectedRow : styles.evenRow}`}
      data-testid="index-row-primary"
      onClick={onSelect}
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
        <span className={styles.readonlyText}>{primaryIndex.columns.join(', ') || '—'}</span>
      </td>
      <td className={`${styles.bodyCell} ${styles.deleteCell}`} />
    </tr>
  )
}

function IndexTableHead() {
  return (
    <thead className={styles.tableHead}>
      <tr>
        {INDEX_COLUMN_LABELS.map((label, index) => (
          <th key={`${label}-${index}`} className={styles.headerCell} scope="col">
            {label}
          </th>
        ))}
      </tr>
    </thead>
  )
}

interface IndexTableProps {
  tabState: TableDesignerTabState
  primaryIndex: TableDesignerIndexDef
  visibleIndexes: VisibleIndexRow[]
  selectedRow: SelectedRow
  rowContext: IndexRowContext
  onSelectPrimary: () => void
}

function IndexTable(table: IndexTableProps) {
  const { tabState, primaryIndex, visibleIndexes, rowContext } = table
  const effectiveSelectedRow = table.selectedRow
  return (
    <div className={styles.gridCard}>
      <div className={styles.tableScroller}>
        <table className={styles.table}>
          <IndexTableHead />
          <tbody className={styles.tableBody}>
            <PrimaryIndexRow
              primaryIndex={primaryIndex}
              isSelected={effectiveSelectedRow === 'primary'}
              onSelect={table.onSelectPrimary}
            />
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
  )
}

function useIndexEditorState(tabId: string) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const [selectedRow, setSelectedRow] = useState<SelectedRow>(null)
  const columns = useMemo(
    () => tabState?.currentSchema.columns ?? [],
    [tabState?.currentSchema.columns]
  )
  const columnNames = useMemo(
    () => columns.map((column) => column.name).filter((name) => !isBlank(name)),
    [columns]
  )
  const visibleIndexes = useMemo(() => visibleIndexesOf(tabState), [tabState])
  const primaryIndex = useMemo(() => (tabState ? derivePrimaryIndex(tabState) : null), [tabState])
  const effectiveSelectedRow = useMemo(
    () => resolveEffectiveSelectedRow(selectedRow, visibleIndexes),
    [selectedRow, visibleIndexes]
  )
  return {
    tabState,
    selectedRow,
    setSelectedRow,
    columnNames,
    visibleIndexes,
    primaryIndex,
    effectiveSelectedRow,
  }
}

export function IndexEditor({ tabId }: IndexEditorProps) {
  const addIndex = useTableDesignerStore((state) => state.addIndex)
  const deleteIndex = useTableDesignerStore((state) => state.deleteIndex)
  const updateIndex = useTableDesignerStore((state) => state.updateIndex)
  const editor = useIndexEditorState(tabId)
  const { tabState, primaryIndex, visibleIndexes, effectiveSelectedRow, setSelectedRow } = editor

  if (!tabState) return null
  if (!primaryIndex) return null

  const handleDelete = (storeIndex: number) => {
    deleteIndex(tabId, storeIndex)
    setSelectedRow((current) => (current === storeIndex ? null : current))
  }

  const rowContext: IndexRowContext = {
    tabId: tabId,
    columnNames: editor.columnNames,
    validationErrors: tabState.validationErrors,
    updateIndex: updateIndex,
    onSelect: setSelectedRow,
    onDelete: handleDelete,
  }

  return (
    <div className={styles.container} data-testid="index-editor">
      <IndexToolbar
        canDeleteSelected={canDeleteSelectedIndex(effectiveSelectedRow, visibleIndexes)}
        onAdd={() => {
          addIndex(tabId)
          setSelectedRow(tabState.currentSchema.indexes.length)
        }}
        onDeleteSelected={() => {
          if (typeof editor.selectedRow === 'number') handleDelete(editor.selectedRow)
        }}
      />

      <IndexTable
        tabState={tabState}
        primaryIndex={primaryIndex}
        visibleIndexes={visibleIndexes}
        selectedRow={effectiveSelectedRow}
        rowContext={rowContext}
        onSelectPrimary={() => setSelectedRow('primary')}
      />
    </div>
  )
}
