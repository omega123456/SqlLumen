import { Link, Trash } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import type { TableDesignerColumnDef, TableDesignerForeignKeyDef } from '../../types/schema'
import { Button } from '../common/Button'
import type { DropdownOption } from '../common/Dropdown'
import { isBlank } from '../../lib/value-checks'
import {
  canDeleteForeignKeyAt,
  foreignKeyEditorSource,
  resolveEffectiveSelectedRow,
  selectionAfterDelete,
} from './foreign-key-editor/foreign-key-editor-model'
import { ForeignKeyRow, type ForeignKeyRowContext } from './foreign-key-editor/ForeignKeyRow'
import {
  useAvailableDatabases,
  useReferencedLookups,
} from './foreign-key-editor/use-referenced-lookups'
import {
  DesignerGridCard,
  DesignerPanel,
  DesignerTableHead,
  DesignerToolbar,
  DesignerToolbarDivider,
  type DesignerHeaderColumn,
} from './designer-table/DesignerTableParts'

interface ForeignKeyEditorProps {
  tabId: string
}

const FOREIGN_KEY_HEADER_COLUMNS: DesignerHeaderColumn[] = [
  { label: '', widthClassName: 'w-4' },
  { label: '#', widthClassName: 'w-10', isCentred: true },
  { label: 'FK name', widthClassName: 'w-53.75' },
  { label: 'Source column', widthClassName: 'w-37.5' },
  { label: 'Referenced DB', widthClassName: 'w-53' },
  { label: 'Referenced table', widthClassName: 'w-53' },
  { label: 'Referenced column', widthClassName: 'w-50' },
  { label: 'On delete', widthClassName: 'w-37.5' },
  { label: 'On update', widthClassName: 'w-37.5' },
  { label: '', widthClassName: 'w-10.5', isCentred: true },
]

function useSourceColumnOptions(columns: TableDesignerColumnDef[]): DropdownOption[] {
  return useMemo(() => {
    const columnNames = columns.map((column) => column.name).filter((name) => !isBlank(name))
    return [
      { value: '', label: 'Select column' },
      ...columnNames.map((name) => ({ value: name, label: name })),
    ]
  }, [columns])
}

function useDatabaseOptions(
  connectionId: string | undefined,
  databaseName: string | undefined
): DropdownOption[] {
  const { availableDatabases, isDatabasesLoading } = useAvailableDatabases(
    connectionId,
    databaseName
  )
  return useMemo(() => {
    const placeholder: DropdownOption = {
      value: '',
      label: isDatabasesLoading ? 'Loading databases...' : 'Select database',
    }
    const databases = new Set(availableDatabases)
    if (databaseName) {
      databases.add(databaseName)
    }
    return [placeholder, ...Array.from(databases).map((name) => ({ value: name, label: name }))]
  }, [availableDatabases, databaseName, isDatabasesLoading])
}

interface ForeignKeyToolbarProps {
  canDeleteSelected: boolean
  onAdd: () => void
  onDeleteSelected: () => void
}

function ForeignKeyToolbar({ canDeleteSelected, onAdd, onDeleteSelected }: ForeignKeyToolbarProps) {
  return (
    <DesignerToolbar>
      <Button size="sm" onClick={onAdd} data-testid="foreign-key-editor-add">
        <Link size={16} weight="regular" />
        <span>Add FK</span>
      </Button>
      <DesignerToolbarDivider />
      <Button
        variant="subtle"
        size="sm"
        dangerText
        onClick={onDeleteSelected}
        disabled={!canDeleteSelected}
        data-testid="foreign-key-editor-delete-selected"
      >
        <Trash size={16} weight="regular" />
        <span>Delete selected</span>
      </Button>
    </DesignerToolbar>
  )
}

interface ForeignKeyTableProps {
  foreignKeys: TableDesignerForeignKeyDef[]
  selectedRow: number | null
  rowContext: ForeignKeyRowContext
}

function ForeignKeyTable({ foreignKeys, selectedRow, rowContext }: ForeignKeyTableProps) {
  return (
    <DesignerGridCard layout="foreignKeys">
      <DesignerTableHead columns={FOREIGN_KEY_HEADER_COLUMNS} />
      <tbody className="font-mono text-size-caption">
        {foreignKeys.map((foreignKey, foreignKeyIndex) => (
          <ForeignKeyRow
            key={`fk-${foreignKeyIndex}`}
            foreignKey={foreignKey}
            position={{
              index: foreignKeyIndex,
              isSelected: selectedRow === foreignKeyIndex,
            }}
            context={rowContext}
          />
        ))}
      </tbody>
    </DesignerGridCard>
  )
}

export function ForeignKeyEditor({ tabId }: ForeignKeyEditorProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const addForeignKey = useTableDesignerStore((state) => state.addForeignKey)
  const deleteForeignKey = useTableDesignerStore((state) => state.deleteForeignKey)
  const updateForeignKey = useTableDesignerStore((state) => state.updateForeignKey)
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const { columns, foreignKeys, connectionId, databaseName } = foreignKeyEditorSource(tabState)
  const sourceColumnOptions = useSourceColumnOptions(columns)
  const databaseOptions = useDatabaseOptions(connectionId, databaseName)
  const referencedLookups = useReferencedLookups({ connectionId, databaseName, foreignKeys })
  const effectiveSelectedRow = resolveEffectiveSelectedRow(selectedRow, foreignKeys.length)

  if (!tabState) {
    return null
  }

  const handleDelete = (foreignKeyIndex: number) => {
    deleteForeignKey(tabId, foreignKeyIndex)
    setSelectedRow((current) => selectionAfterDelete(current, foreignKeyIndex))
  }

  const rowContext: ForeignKeyRowContext = {
    tabId: tabId,
    databaseName: databaseName,
    sourceColumnOptions: sourceColumnOptions,
    databaseOptions: databaseOptions,
    referencedLookups: referencedLookups,
    updateForeignKey: updateForeignKey,
    onSelect: setSelectedRow,
    onDelete: handleDelete,
  }

  return (
    <DesignerPanel testId="foreign-key-editor">
      <ForeignKeyToolbar
        canDeleteSelected={canDeleteForeignKeyAt(foreignKeys, effectiveSelectedRow)}
        onAdd={() => {
          addForeignKey(tabId)
          setSelectedRow(foreignKeys.length)
        }}
        onDeleteSelected={() => {
          if (effectiveSelectedRow !== null) handleDelete(effectiveSelectedRow)
        }}
      />
      <ForeignKeyTable
        foreignKeys={foreignKeys}
        selectedRow={effectiveSelectedRow}
        rowContext={rowContext}
      />
    </DesignerPanel>
  )
}
