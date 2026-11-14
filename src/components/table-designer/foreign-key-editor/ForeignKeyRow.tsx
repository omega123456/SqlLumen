import { Trash } from '@phosphor-icons/react'
import type { TableDesignerStore } from '../../../stores/table-designer-store'
import type { TableDesignerForeignKeyDef } from '../../../types/schema'
import { Button } from '../../common/Button'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import {
  EMPTY_TEXT_FALLBACK,
  cellInputClassName,
  cellSelectClassName,
  referencedTargetKeyFor,
  rowStripeClassName,
  stopRowSelection,
} from './foreign-key-editor-model'
import type { ReferencedLookups } from './use-referenced-lookups'
import styles from '../ForeignKeyEditor.module.css'

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
  const rowClassName = `${styles.row} ${rowStripeClassName(position.isSelected, position.index)}`
  return (
    <tr
      className={rowClassName}
      data-testid={`fk-row-${position.index}`}
      onClick={() => context.onSelect(position.index)}
    >
      <td className={`${styles.bodyCell} ${styles.indicatorCell}`}>
        <span className={styles.rowAccent} aria-hidden />
      </td>
      <td className={`${styles.bodyCell} ${styles.rowNumberCell}`}>{position.index + 1}</td>
      {foreignKey.isComposite ? (
        <CompositeForeignKeyCells
          foreignKey={foreignKey}
          index={position.index}
          databaseName={context.databaseName}
        />
      ) : (
        <EditableForeignKeyCells foreignKey={foreignKey} position={position} context={context} />
      )}
    </tr>
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
      <td className={styles.bodyCell}>
        <span className={styles.readonlyText}>{foreignKey.name || EMPTY_TEXT_FALLBACK}</span>
      </td>
      <td className={styles.bodyCell} colSpan={5}>
        <div className={styles.compositeCell} data-testid={`fk-composite-badge-${index}`}>
          <span className={styles.warningBadge}>Multi-column — view only</span>
          <div className={styles.compositeSummary}>
            <span>{foreignKey.sourceColumn || EMPTY_TEXT_FALLBACK}</span>
            <span>→</span>
            <span>
              {referencedDatabase}.{foreignKey.referencedTable || EMPTY_TEXT_FALLBACK}.
              {foreignKey.referencedColumn || EMPTY_TEXT_FALLBACK}
            </span>
          </div>
        </div>
      </td>
      <td className={styles.bodyCell}>
        <span className={styles.readonlyText}>{foreignKey.onDelete || EMPTY_TEXT_FALLBACK}</span>
      </td>
      <td className={styles.bodyCell}>
        <span className={styles.readonlyText}>{foreignKey.onUpdate || EMPTY_TEXT_FALLBACK}</span>
      </td>
      <td className={`${styles.bodyCell} ${styles.deleteCell}`} />
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
  const { index, isSelected } = position
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
        className={cellInputClassName(isSelected)}
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
        triggerClassName={cellSelectClassName(isSelected)}
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
    <td className={styles.bodyCell}>
      <div onClick={stopRowSelection}>
        <Dropdown
          id={`fk-${field}-${tabId}-${position.index}`}
          ariaLabel={cell.ariaLabel}
          options={cell.options}
          value={cell.value}
          data-testid={`fk-${field}-${position.index}`}
          onChange={cell.onChange}
          workspaceTabId={tabId}
          triggerClassName={cellSelectClassName(position.isSelected)}
          disabled={cell.disabled}
        />
      </div>
    </td>
  )
}

interface ForeignKeyDeleteCellProps {
  foreignKey: TableDesignerForeignKeyDef
  index: number
  onDelete: (index: number) => void
}

function ForeignKeyDeleteCell({ foreignKey, index, onDelete }: ForeignKeyDeleteCellProps) {
  return (
    <td className={`${styles.bodyCell} ${styles.deleteCell}`}>
      <Button
        variant="subtle"
        size="sm"
        dangerText
        iconOnly
        aria-label={`Delete foreign key ${foreignKey.name || index + 1}`}
        data-testid={`fk-delete-${index}`}
        onClick={(event) => {
          event.stopPropagation()
          onDelete(index)
        }}
      >
        <Trash size={14} weight="bold" />
      </Button>
    </td>
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
      <td className={styles.bodyCell}>
        <ReferencedColumnCell
          foreignKey={foreignKey}
          position={position}
          context={context}
          referencedDatabase={referencedDatabase}
        />
      </td>
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
  const { index, isSelected } = position
  const update: ForeignKeyUpdate = (field, value) =>
    updateForeignKey(tabId, { index: index, field: field, value: value })

  return (
    <>
      <td className={styles.bodyCell}>
        <TextInput
          type="text"
          variant="tableCell"
          value={foreignKey.name}
          className={cellInputClassName(isSelected)}
          data-testid={`fk-name-${index}`}
          onClick={stopRowSelection}
          onChange={(event) => update('name', event.target.value)}
        />
      </td>
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
