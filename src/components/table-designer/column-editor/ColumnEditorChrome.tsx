import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type { SelectionMoves, TraversalDirection } from '../column-editor-model'
import {
  DesignerBodyCell,
  DesignerTableHead,
  DesignerToolbar,
  DesignerToolbarDivider,
  type DesignerHeaderColumn,
} from '../designer-table/DesignerTableParts'

const HEADER_COLUMNS: DesignerHeaderColumn[] = [
  { label: '#', isCentred: true },
  { label: 'Name' },
  { label: 'Type' },
  { label: 'Length' },
  { label: 'Signed' },
  { label: 'Nullable', isCentred: true },
  { label: 'PK', isCentred: true },
  { label: 'AI', isCentred: true },
  { label: 'Default' },
  { label: 'Comment' },
  { label: '' },
]

const GHOST_ROW_LABEL_SPAN = HEADER_COLUMNS.length - 1

interface ColumnEditorToolbarProps {
  moves: SelectionMoves
  onAdd: () => void
  onMove: (direction: TraversalDirection) => void
  onDeleteSelected: () => void
}

export function ColumnEditorToolbar({
  moves,
  onAdd,
  onMove,
  onDeleteSelected,
}: ColumnEditorToolbarProps) {
  return (
    <DesignerToolbar>
      <Button size="sm" onClick={onAdd} data-testid="column-editor-add">
        <Plus size={16} weight="regular" />
        <span>Add column</span>
      </Button>
      <Button
        variant="subtle"
        size="sm"
        onClick={() => onMove(-1)}
        disabled={!moves.canMoveUp}
        data-testid="column-editor-move-up"
      >
        <ArrowUp size={16} weight="regular" />
        <span>Move up</span>
      </Button>
      <Button
        variant="subtle"
        size="sm"
        onClick={() => onMove(1)}
        disabled={!moves.canMoveDown}
        data-testid="column-editor-move-down"
      >
        <ArrowDown size={16} weight="regular" />
        <span>Move down</span>
      </Button>
      <DesignerToolbarDivider />
      <Button
        variant="subtle"
        size="sm"
        dangerText
        onClick={onDeleteSelected}
        disabled={!moves.canDelete}
        data-testid="column-editor-delete"
      >
        <Trash size={16} weight="regular" />
        <span>Delete</span>
      </Button>
    </DesignerToolbar>
  )
}

export function ColumnEditorHead() {
  return <DesignerTableHead columns={HEADER_COLUMNS} />
}

export function GhostAddRow({ onAdd }: { onAdd: () => void }) {
  return (
    <tr
      className="cursor-pointer text-light-primary italic hover:bg-light-fill-subtle-hover dark:text-dark-primary dark:hover:bg-dark-fill-subtle-hover"
      onClick={onAdd}
      data-testid="column-editor-ghost-add"
    >
      <DesignerBodyCell edge="closing">+</DesignerBodyCell>
      <DesignerBodyCell edge="closing" colSpan={GHOST_ROW_LABEL_SPAN}>
        Click to add new column...
      </DesignerBodyCell>
    </tr>
  )
}
