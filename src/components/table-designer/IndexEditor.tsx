import { Plus, Trash } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import {
  useTableDesignerStore,
  type TableDesignerTabState,
} from '../../stores/table-designer-store'
import type { TableDesignerIndexDef } from '../../types/schema'
import { Button } from '../common/Button'
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
import {
  DesignerBodyCell,
  DesignerDeleteCell,
  DesignerGridCard,
  DesignerIndicatorCell,
  DesignerPanel,
  DesignerRow,
  DesignerRowNumberCell,
  DesignerTableHead,
  DesignerToolbar,
  DesignerToolbarDivider,
  type DesignerHeaderColumn,
} from './designer-table/DesignerTableParts'
import { selectedAccent } from './designer-table/designer-accent'

interface IndexEditorProps {
  tabId: string
}

const INDEX_HEADER_COLUMNS: DesignerHeaderColumn[] = [
  { label: '', widthClassName: 'w-4' },
  { label: '#', widthClassName: 'w-10', isCentred: true },
  { label: 'Name' },
  { label: 'Type', widthClassName: 'w-35' },
  { label: 'Columns', widthClassName: 'w-65' },
  { label: '', widthClassName: 'w-10.5', isCentred: true },
]

interface IndexToolbarProps {
  canDeleteSelected: boolean
  onAdd: () => void
  onDeleteSelected: () => void
}

function IndexToolbar({ canDeleteSelected, onAdd, onDeleteSelected }: IndexToolbarProps) {
  return (
    <DesignerToolbar>
      <Button size="sm" onClick={onAdd} data-testid="index-editor-add">
        <Plus size={16} weight="regular" />
        <span>Add index</span>
      </Button>
      <DesignerToolbarDivider />
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
    </DesignerToolbar>
  )
}

interface PrimaryIndexRowProps {
  primaryIndex: TableDesignerIndexDef
  isSelected: boolean
  onSelect: () => void
}

function PrimaryIndexRow({ primaryIndex, isSelected, onSelect }: PrimaryIndexRowProps) {
  return (
    <DesignerRow isSelected={isSelected} data-testid="index-row-primary" onClick={onSelect}>
      <DesignerIndicatorCell accent={selectedAccent(isSelected)} />
      <DesignerRowNumberCell>1</DesignerRowNumberCell>
      <DesignerBodyCell data-testid="index-primary-name">PRIMARY</DesignerBodyCell>
      <DesignerBodyCell data-testid="index-primary-type">PRIMARY</DesignerBodyCell>
      <DesignerBodyCell data-testid="index-primary-columns">
        {primaryIndex.columns.join(', ') || '—'}
      </DesignerBodyCell>
      <DesignerDeleteCell />
    </DesignerRow>
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
    <DesignerGridCard layout="indexes">
      <DesignerTableHead columns={INDEX_HEADER_COLUMNS} />
      <tbody className="font-mono text-size-caption">
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
    </DesignerGridCard>
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
    <DesignerPanel testId="index-editor">
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
    </DesignerPanel>
  )
}
