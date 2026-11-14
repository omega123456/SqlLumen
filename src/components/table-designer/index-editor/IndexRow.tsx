import { Trash } from '@phosphor-icons/react'
import type { TableDesignerIndexDef } from '../../../types/schema'
import { Button } from '../../common/Button'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import {
  MAX_LISTED_COLUMN_LABELS,
  ariaInvalidFor,
  errorClassName,
  formatSelectedColumnsSummary,
  indexInputClassName,
  indexRowStripeClassName,
  stopRowSelection,
  type IndexRowContext,
  type IndexRowPosition,
} from './index-editor-model'
import styles from '../IndexEditor.module.css'

const FIRST_SECONDARY_INDEX_ROW_NUMBER = 2

const INDEX_TYPE_DROPDOWN_OPTIONS: DropdownOption[] = [
  { value: 'UNIQUE', label: 'UNIQUE' },
  { value: 'INDEX', label: 'INDEX' },
  { value: 'FULLTEXT', label: 'FULLTEXT' },
]

interface IndexRowProps {
  index: TableDesignerIndexDef
  position: IndexRowPosition
  context: IndexRowContext
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

interface AddColumnsFirstButtonProps {
  columnsError: string | undefined
  visibleIndex: number
  onClick: (event: React.MouseEvent) => void
}

function AddColumnsFirstButton({
  columnsError,
  visibleIndex,
  onClick,
}: AddColumnsFirstButtonProps) {
  return (
    <Button
      type="button"
      contentAlign="start"
      className={`${styles.columnButton} ${errorClassName(columnsError)}`}
      aria-invalid={ariaInvalidFor(columnsError)}
      title={columnsError}
      data-testid={`index-columns-button-${visibleIndex}`}
      onClick={onClick}
    >
      Add columns first
    </Button>
  )
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
      <AddColumnsFirstButton
        columnsError={columnsError}
        visibleIndex={visibleIndex}
        onClick={selectRow}
      />
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
        context.updateIndex(tabId, {
          index: storeIndex,
          field: 'columns',
          value: columnNames.filter((name) => nextColumns.includes(name)),
        })
      }}
    />
  )
}

interface IndexCellProps extends IndexRowProps {
  error?: string | undefined
}

function IndexNameCell({ index, position, context, error }: IndexCellProps) {
  const { storeIndex, visibleIndex, isSelected } = position
  return (
    <td className={styles.bodyCell}>
      <TextInput
        type="text"
        variant="tableCell"
        value={index.name}
        invalid={!!error}
        className={indexInputClassName(isSelected)}
        aria-invalid={ariaInvalidFor(error)}
        title={error}
        data-testid={`index-name-${visibleIndex}`}
        onClick={stopRowSelection}
        onChange={(event) =>
          context.updateIndex(context.tabId, {
            index: storeIndex,
            field: 'name',
            value: event.target.value,
          })
        }
      />
      <FieldError error={error} testId={`index-name-error-${visibleIndex}`} />
    </td>
  )
}

function IndexTypeCell({ index, position, context }: IndexCellProps) {
  const { tabId } = context
  const { storeIndex, visibleIndex, isSelected } = position
  return (
    <td className={styles.bodyCell}>
      <div onClick={stopRowSelection}>
        <Dropdown
          id={`index-type-${tabId}-${visibleIndex}`}
          ariaLabel="Index type"
          options={INDEX_TYPE_DROPDOWN_OPTIONS}
          value={index.indexType}
          data-testid={`index-type-${visibleIndex}`}
          onChange={(value) =>
            context.updateIndex(tabId, { index: storeIndex, field: 'indexType', value: value })
          }
          triggerClassName={`${styles.cellSelect} ${indexInputClassName(isSelected)}`}
        />
      </div>
    </td>
  )
}

function IndexDeleteCell({ index, position, context }: IndexCellProps) {
  const { storeIndex, visibleIndex } = position
  return (
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
  )
}

export function IndexRow(props: IndexRowProps) {
  const { index, position, context } = props
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
      <IndexNameCell {...props} error={nameError} />
      <IndexTypeCell {...props} />
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
      <IndexDeleteCell {...props} />
    </tr>
  )
}
