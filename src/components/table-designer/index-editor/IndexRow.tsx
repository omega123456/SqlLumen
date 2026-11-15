import type { TableDesignerIndexDef } from '../../../types/schema'
import { Button } from '../../common/Button'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import {
  ariaInvalidFor,
  formatSelectedColumnsSummary,
  stopRowSelection,
  type IndexRowContext,
  type IndexRowPosition,
} from './index-editor-model'
import {
  DesignerBodyCell,
  DesignerDeleteButton,
  DesignerDeleteCell,
  DesignerFieldError,
  DesignerIndicatorCell,
  DesignerRow,
  DesignerRowNumberCell,
} from '../designer-table/DesignerTableParts'
import { type DesignerAccent } from '../designer-table/designer-accent'

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
      size="cell"
      contentAlign="start"
      className="w-full min-w-0"
      invalid={Boolean(columnsError)}
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
      triggerSize="cell"
      triggerClassName="min-w-0"
      invalid={Boolean(columnsError)}
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
  const { storeIndex, visibleIndex } = position
  return (
    <DesignerBodyCell>
      <TextInput
        type="text"
        variant="tableCell"
        value={index.name}
        invalid={!!error}
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
      <DesignerFieldError error={error} testId={`index-name-error-${visibleIndex}`} />
    </DesignerBodyCell>
  )
}

function IndexTypeCell({ index, position, context }: IndexCellProps) {
  const { tabId } = context
  const { storeIndex, visibleIndex } = position
  return (
    <DesignerBodyCell>
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
          triggerSize="monoCell"
        />
      </div>
    </DesignerBodyCell>
  )
}

function IndexDeleteCell({ index, position, context }: IndexCellProps) {
  const { storeIndex, visibleIndex } = position
  return (
    <DesignerDeleteCell>
      <DesignerDeleteButton
        label={`Delete index ${index.name || visibleIndex + 1}`}
        testId={`index-delete-${visibleIndex}`}
        onDelete={() => context.onDelete(storeIndex)}
      />
    </DesignerDeleteCell>
  )
}

function indexAccent(position: IndexRowPosition): DesignerAccent {
  if (position.isSelected) return 'selected'
  if (position.isNew) return 'added'
  return 'idle'
}

export function IndexRow(props: IndexRowProps) {
  const { index, position, context } = props
  const { storeIndex, visibleIndex, isSelected } = position
  const displayIndex = visibleIndex + FIRST_SECONDARY_INDEX_ROW_NUMBER
  const nameError = context.validationErrors[`indexes.${storeIndex}.name`]
  const columnsError = context.validationErrors[`indexes.${storeIndex}.columns`]

  return (
    <DesignerRow
      isSelected={isSelected}
      data-testid={`index-row-${visibleIndex}`}
      onClick={() => context.onSelect(storeIndex)}
    >
      <DesignerIndicatorCell accent={indexAccent(position)} />
      <DesignerRowNumberCell>{displayIndex}</DesignerRowNumberCell>
      <IndexNameCell {...props} error={nameError} />
      <IndexTypeCell {...props} />
      <DesignerBodyCell>
        <div className="relative" onClick={stopRowSelection}>
          <IndexColumnsSelector
            index={index}
            position={position}
            context={context}
            columnsError={columnsError}
          />
        </div>
        <DesignerFieldError error={columnsError} testId={`index-columns-error-${visibleIndex}`} />
      </DesignerBodyCell>
      <IndexDeleteCell {...props} />
    </DesignerRow>
  )
}
