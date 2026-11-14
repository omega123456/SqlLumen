import { CaretRight, CircleNotch } from '@phosphor-icons/react'
import type { TreeNode as TreeNodeData } from '../../../types/schema'
import styles from '../TreeNode.module.css'

interface TreeNodeChevronProps {
  hasChildren: boolean
  isLoading: boolean
  showExpandedChrome: boolean
  onClick: (event: React.MouseEvent) => void
}

export function TreeNodeChevron({
  hasChildren,
  isLoading,
  showExpandedChrome,
  onClick,
}: TreeNodeChevronProps) {
  if (!hasChildren) return <span className={styles.chevronPlaceholder} />
  if (isLoading) {
    return (
      <span className={styles.spinner} data-testid="tree-node-spinner">
        <CircleNotch size={12} weight="regular" />
      </span>
    )
  }
  return (
    <span
      className={`${styles.chevron} ${showExpandedChrome ? styles.chevronExpanded : ''}`}
      onClick={onClick}
      role="presentation"
      data-testid="tree-node-chevron"
    >
      <CaretRight size={12} weight="bold" />
    </span>
  )
}

export function ColumnTypeAnnotation({ node }: { node: TreeNodeData }) {
  const columnType = node.type === 'column' ? node.metadata?.columnType : undefined
  if (!columnType) return null
  return <span className={styles.columnType}>{columnType}</span>
}
