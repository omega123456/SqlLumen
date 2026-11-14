import {
  CalendarBlank,
  Columns,
  Database,
  Eye,
  Folder,
  FolderOpen,
  Gear,
  Lightning,
  MathOperations,
  Table,
} from '@phosphor-icons/react'
import type { NodeType } from '../../../types/schema'
import styles from '../TreeNode.module.css'

interface NodeIcon {
  icon: React.ReactNode
  className: string
}

const NODE_ICONS: Partial<Record<NodeType, NodeIcon>> = {
  database: { icon: <Database size={16} weight="regular" />, className: styles.iconDatabase },
  table: { icon: <Table size={16} weight="regular" />, className: styles.iconTable },
  view: { icon: <Eye size={16} weight="regular" />, className: styles.iconView },
  procedure: { icon: <Gear size={16} weight="regular" />, className: styles.iconProcedure },
  function: { icon: <MathOperations size={16} weight="regular" />, className: styles.iconFunction },
  trigger: { icon: <Lightning size={16} weight="regular" />, className: styles.iconTrigger },
  event: { icon: <CalendarBlank size={16} weight="regular" />, className: styles.iconEvent },
  column: { icon: <Columns size={14} weight="regular" />, className: styles.iconColumn },
}

const DEFAULT_NODE_ICON: NodeIcon = { icon: <Database size={16} weight="regular" />, className: '' }

export function getNodeIcon(type: NodeType, isExpanded: boolean): NodeIcon {
  if (type !== 'category') return NODE_ICONS[type] ?? DEFAULT_NODE_ICON
  return {
    icon: isExpanded ? <FolderOpen size={16} weight="fill" /> : <Folder size={16} weight="fill" />,
    className: styles.iconCategory,
  }
}
