import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type { SelectionMoves, TraversalDirection } from '../column-editor-model'
import styles from '../ColumnEditor.module.css'

interface HeaderCell {
  label: string
  centred: boolean
}

const HEADER_CELLS: HeaderCell[] = [
  { label: '#', centred: true },
  { label: 'Name', centred: false },
  { label: 'Type', centred: false },
  { label: 'Length', centred: false },
  { label: 'Signed', centred: false },
  { label: 'Nullable', centred: true },
  { label: 'PK', centred: true },
  { label: 'AI', centred: true },
  { label: 'Default', centred: false },
  { label: 'Comment', centred: false },
  { label: '', centred: false },
]

const GHOST_ROW_LABEL_SPAN = HEADER_CELLS.length - 1

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
    <div className={styles.toolbar}>
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
      <span className={styles.toolbarDivider} aria-hidden />
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
    </div>
  )
}

export function ColumnEditorHead() {
  return (
    <thead className={styles.tableHead}>
      <tr>
        {HEADER_CELLS.map(({ label, centred }, index) => (
          <th
            key={`${label}-${index}`}
            className={`${styles.headerCell} ${centred ? styles.centred : ''}`}
            scope="col"
          >
            {label}
          </th>
        ))}
      </tr>
    </thead>
  )
}

export function GhostAddRow({ onAdd }: { onAdd: () => void }) {
  return (
    <tr className={styles.ghostRow} onClick={onAdd} data-testid="column-editor-ghost-add">
      <td className={styles.bodyCell}>+</td>
      <td className={styles.bodyCell} colSpan={GHOST_ROW_LABEL_SPAN}>
        Click to add new column...
      </td>
    </tr>
  )
}
