import { CaretRight, CircleNotch } from '@phosphor-icons/react'
import { joinClassNames } from '../../../lib/class-names'
import type { TreeNode as TreeNodeData } from '../../../types/schema'

interface TreeNodeChevronProps {
  hasChildren: boolean
  isLoading: boolean
  showExpandedChrome: boolean
  onClick: (event: React.MouseEvent) => void
}

type ChevronOrientation = 'collapsed' | 'expanded'

const CHEVRON_ORIENTATION_CLASSES: Record<ChevronOrientation, string> = {
  collapsed: '',
  expanded: 'rotate-90',
}

function orientationOf(showExpandedChrome: boolean): ChevronOrientation {
  if (showExpandedChrome) return 'expanded'
  return 'collapsed'
}

export function TreeNodeChevron({
  hasChildren,
  isLoading,
  showExpandedChrome,
  onClick,
}: TreeNodeChevronProps) {
  if (!hasChildren) return <span className="w-4 shrink-0" />
  if (isLoading) {
    return (
      <span
        className="flex size-4 shrink-0 animate-spin-800ms items-center justify-center text-light-primary window-blurred:animate-spin-800ms-paused dark:text-dark-primary"
        data-testid="tree-node-spinner"
      >
        <CircleNotch size={12} weight="regular" />
      </span>
    )
  }
  return (
    <span
      className={joinClassNames([
        'flex size-4 shrink-0 items-center justify-center text-light-outline transition-rotate duration-120 dark:text-dark-outline',
        CHEVRON_ORIENTATION_CLASSES[orientationOf(showExpandedChrome)],
      ])}
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
  return (
    <span className="ml-auto shrink-0 text-size-caption whitespace-nowrap text-light-outline dark:text-dark-outline">
      {columnType}
    </span>
  )
}
