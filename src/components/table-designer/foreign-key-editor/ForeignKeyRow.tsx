import type { TableDesignerStore } from '../../../stores/table-designer-store'
import type { TableDesignerForeignKeyDef } from '../../../types/schema'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import {
  EMPTY_TEXT_FALLBACK,
  referencedTargetKeyFor,
  stopRowSelection,
} from './foreign-key-editor-model'
import type { ReferencedLookups } from './use-referenced-lookups'
import {
  DesignerBodyCell,
  DesignerDeleteButton,
  DesignerDeleteCell,
  DesignerIndicatorCell,
  DesignerRow,
  DesignerRowNumberCell,
} from '../designer-table/DesignerTableParts'
import { selectedAccent } from '../designer-table/designer-accent'

const ACTION_OPTIONS = ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT']

const ACTION_DROPDOWN_OPTIONS: DropdownOption[] = ACTION_OPTIONS.map((action) => ({
  value: action,
  label: action,
}))

export interface ForeignKeyRowContext {
  tabId: string
  databaseName: string | undefined
  sourceColumnOptions: DropdownOption[]
  databaseOptions: DropdownOption[]
  referencedLookups: ReferencedLookups
  updateForeignKey: TableDesignerStore['updateForeignKey']
  onSelect: (index: number) => void
  onDelete: (index: number) => void
}

interface ForeignKeyRowPosition {
  index: number
  isSelected: boolean
}

interface ForeignKeyRowProps {
  foreignKey: TableDesignerForeignKeyDef
  position: ForeignKeyRowPosition
  context: ForeignKeyRowContext
}

export function ForeignKeyRow({ foreignKey, position, context }: ForeignKeyRowProps) {
  return (
    <DesignerRow
      isSelected={position.isSelected}
      data-testid={`fk-row-${position.index}`}
      onClick={() => context.onSelect(position.index)}
    >
      <DesignerIndicatorCell accent={selectedAccent(position.isSelected)} />
      <DesignerRowNumberCell>{position.index + 1}</DesignerRowNumberCell>
      {foreignKey.isComposite ? (
        <CompositeForeignKeyCells
          foreignKey={foreignKey}
          index={position.index}
          databaseName={context.databaseName}
        />
      ) : (
        <EditableForeignKeyCells foreignKey={foreignKey} position={position} context={context} />
      )}
    </DesignerRow>
  )
}

interface CompositeForeignKeyCellsProps {
  foreignKey: TableDesignerForeignKeyDef
  index: number
  databaseName: string | undefined
}

function CompositeForeignKeyCells({
  foreignKey,
  index,
  databaseName,
}: CompositeForeignKeyCellsProps) {
  const referencedDatabase = foreignKey.referencedDatabase || databaseName || EMPTY_TEXT_FALLBACK
  return (
    <>
      <DesignerBodyCell>{foreignKey.name || EMPTY_TEXT_FALLBACK}</DesignerBodyCell>
      <DesignerBodyCell colSpan={5}>
        <div className="flex flex-col gap-2" data-testid={`fk-composite-badge-${index}`}>
          <span className="inline-flex self-start rounded-pill bg-light-warning-container-a45 px-2 py-1 text-size-caption font-semibold text-light-warning dark:bg-dark-warning-container-a45 dark:text-dark-warning">
            Multi-column — view only
          </span>
          <div className="flex flex-wrap gap-2 text-light-on-surface-variant dark:text-dark-on-surface-variant">
            <span>{foreignKey.sourceColumn || EMPTY_TEXT_FALLBACK}</span>
            <span>→</span>
            <span>
              {referencedDatabase}.{foreignKey.referencedTable || EMPTY_TEXT_FALLBACK}.
              {foreignKey.referencedColumn || EMPTY_TEXT_FALLBACK}
            </span>
          </div>
        </div>
      </DesignerBodyCell>
      <DesignerBodyCell>{foreignKey.onDelete || EMPTY_TEXT_FALLBACK}</DesignerBodyCell>
      <DesignerBodyCell>{foreignKey.onUpdate || EMPTY_TEXT_FALLBACK}</DesignerBodyCell>
      <DesignerDeleteCell />
    </>
  )
}

function referencedTableOptionsFor(
  lookups: ReferencedLookups,
  referencedDatabase: string
): DropdownOption[] {
  const isLoading = lookups.loadingTablesByDatabase[referencedDatabase]
  const tableNames = lookups.tablesByDatabase[referencedDatabase] ?? []
  return [
    { value: '', label: isLoading ? 'Loading tables...' : 'Select table' },
    ...tableNames.map((tableName) => ({ value: tableName, label: tableName })),
  ]
}

function referencedColumnNamesFor(lookups: ReferencedLookups, targetKey: string): string[] {
  if (targetKey === '') return []
  return lookups.columnsByTarget[targetKey] ?? []
}

function isReferencedColumnLoadingFor(lookups: ReferencedLookups, targetKey: string): boolean {
  return Boolean(targetKey && lookups.loadingColumnsByTarget[targetKey])
}

interface ReferencedColumnCellProps {
  foreignKey: TableDesignerForeignKeyDef
  position: ForeignKeyRowPosition
  context: ForeignKeyRowContext
  referencedDatabase: string
}

function ReferencedColumnCell({
  foreignKey,
  position,
  context,
  referencedDatabase,
}: ReferencedColumnCellProps) {
  const { tabId, updateForeignKey, referencedLookups } = context
  const { index } = position
  const targetKey = referencedTargetKeyFor(referencedDatabase, foreignKey.referencedTable)
  const columnNames = referencedColumnNamesFor(referencedLookups, targetKey)
  const isLoading = isReferencedColumnLoadingFor(referencedLookups, targetKey)
  const updateReferencedColumn = (value: string) =>
    updateForeignKey(tabId, { index: index, field: 'referencedColumn', value: value })
  const hasColumnChoices = foreignKey.referencedTable !== '' && columnNames.length > 0

  if (!hasColumnChoices) {
    return (
      <TextInput
        type="text"
        variant="tableCell"
        value={foreignKey.referencedColumn}
        placeholder="column name"
        data-testid={`fk-referenced-column-${index}`}
        onClick={stopRowSelection}
        onChange={(event) => updateReferencedColumn(event.target.value)}
      />
    )
  }

  return (
    <div onClick={stopRowSelection}>
      <Dropdown
        id={`fk-referenced-column-${tabId}-${index}`}
        ariaLabel="Referenced column"
        options={[
          { value: '', label: isLoading ? 'Loading columns...' : 'Select column' },
          ...columnNames.map((columnName) => ({ value: columnName, label: columnName })),
        ]}
        value={foreignKey.referencedColumn}
        data-testid={`fk-referenced-column-${index}`}
        onChange={updateReferencedColumn}
        workspaceTabId={tabId}
        triggerSize="monoCell"
      />
    </div>
  )
}

type ForeignKeyField = keyof TableDesignerForeignKeyDef

interface ForeignKeyDropdownCellProps {
  field: string
  ariaLabel: string
  options: DropdownOption[]
  value: string
  position: ForeignKeyRowPosition
  tabId: string
  onChange: (value: string) => void
  disabled?: boolean
}

function ForeignKeyDropdownCell(cell: ForeignKeyDropdownCellProps) {
  const { field, position, tabId } = cell
  return (
    <DesignerBodyCell>
      <div onClick={stopRowSelection}>
        <Dropdown
          id={`fk-${field}-${tabId}-${position.index}`}
          ariaLabel={cell.ariaLabel}
          options={cell.options}
          value={cell.value}
          data-testid={`fk-${field}-${position.index}`}
          onChange={cell.onChange}
          workspaceTabId={tabId}
          triggerSize="monoCell"
          disabled={cell.disabled}
        />
      </div>
    </DesignerBodyCell>
  )
}

interface ForeignKeyDeleteCellProps {
  foreignKey: TableDesignerForeignKeyDef
  index: number
  onDelete: (index: number) => void
}

function ForeignKeyDeleteCell({ foreignKey, index, onDelete }: ForeignKeyDeleteCellProps) {
  return (
    <DesignerDeleteCell>
      <DesignerDeleteButton
        label={`Delete foreign key ${foreignKey.name || index + 1}`}
        testId={`fk-delete-${index}`}
        onDelete={() => onDelete(index)}
      />
    </DesignerDeleteCell>
  )
}

interface EditableForeignKeyCellsProps {
  foreignKey: TableDesignerForeignKeyDef
  position: ForeignKeyRowPosition
  context: ForeignKeyRowContext
}

type ForeignKeyUpdate = (field: ForeignKeyField, value: unknown) => void

interface ForeignKeyCellGroupProps extends EditableForeignKeyCellsProps {
  update: ForeignKeyUpdate
}

function ReferenceTargetCells({ foreignKey, position, context, update }: ForeignKeyCellGroupProps) {
  const referencedDatabase = foreignKey.referencedDatabase || context.databaseName || ''
  const cellPlacement = { position: position, tabId: context.tabId }
  return (
    <>
      <ForeignKeyDropdownCell
        {...cellPlacement}
        field="referenced-database"
        ariaLabel="Referenced database"
        options={context.databaseOptions}
        value={referencedDatabase}
        onChange={(value) => {
          update('referencedDatabase', value)
          update('referencedTable', '')
          update('referencedColumn', '')
        }}
      />
      <ForeignKeyDropdownCell
        {...cellPlacement}
        field="referenced-table"
        ariaLabel="Referenced table"
        options={referencedTableOptionsFor(context.referencedLookups, referencedDatabase)}
        value={foreignKey.referencedTable}
        onChange={(value) => {
          update('referencedTable', value)
          update('referencedColumn', '')
        }}
        disabled={referencedDatabase === ''}
      />
      <DesignerBodyCell>
        <ReferencedColumnCell
          foreignKey={foreignKey}
          position={position}
          context={context}
          referencedDatabase={referencedDatabase}
        />
      </DesignerBodyCell>
    </>
  )
}

function ReferentialActionCells({
  foreignKey,
  position,
  context,
  update,
}: ForeignKeyCellGroupProps) {
  const cellPlacement = { position: position, tabId: context.tabId }
  return (
    <>
      <ForeignKeyDropdownCell
        {...cellPlacement}
        field="on-delete"
        ariaLabel="On delete"
        options={ACTION_DROPDOWN_OPTIONS}
        value={foreignKey.onDelete}
        onChange={(value) => update('onDelete', value)}
      />
      <ForeignKeyDropdownCell
        {...cellPlacement}
        field="on-update"
        ariaLabel="On update"
        options={ACTION_DROPDOWN_OPTIONS}
        value={foreignKey.onUpdate}
        onChange={(value) => update('onUpdate', value)}
      />
    </>
  )
}

function EditableForeignKeyCells(cells: EditableForeignKeyCellsProps) {
  const { foreignKey, position, context } = cells
  const { tabId, updateForeignKey } = context
  const { index } = position
  const update: ForeignKeyUpdate = (field, value) =>
    updateForeignKey(tabId, { index: index, field: field, value: value })

  return (
    <>
      <DesignerBodyCell>
        <TextInput
          type="text"
          variant="tableCell"
          value={foreignKey.name}
          data-testid={`fk-name-${index}`}
          onClick={stopRowSelection}
          onChange={(event) => update('name', event.target.value)}
        />
      </DesignerBodyCell>
      <ForeignKeyDropdownCell
        position={position}
        tabId={tabId}
        field="source-column"
        ariaLabel="Source column"
        options={context.sourceColumnOptions}
        value={foreignKey.sourceColumn}
        onChange={(value) => update('sourceColumn', value)}
      />
      <ReferenceTargetCells {...cells} update={update} />
      <ReferentialActionCells {...cells} update={update} />
      <ForeignKeyDeleteCell foreignKey={foreignKey} index={index} onDelete={context.onDelete} />
    </>
  )
}
