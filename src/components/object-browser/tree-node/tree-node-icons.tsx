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

interface NodeIcon {
  icon: React.ReactNode
  className: string
}

const NODE_ICONS: Partial<Record<NodeType, NodeIcon>> = {
  database: {
    icon: <Database size={16} weight="regular" />,
    className: 'text-light-primary dark:text-dark-primary',
  },
  table: {
    icon: <Table size={16} weight="regular" />,
    className: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
  },
  view: { icon: <Eye size={16} weight="regular" />, className: 'text-view-icon' },
  procedure: {
    icon: <Gear size={16} weight="regular" />,
    className: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
  },
  function: {
    icon: <MathOperations size={16} weight="regular" />,
    className: 'text-light-tertiary dark:text-dark-tertiary',
  },
  trigger: {
    icon: <Lightning size={16} weight="regular" />,
    className: 'text-light-warning dark:text-dark-warning',
  },
  event: {
    icon: <CalendarBlank size={16} weight="regular" />,
    className: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
  },
  column: {
    icon: <Columns size={14} weight="regular" />,
    className: 'text-light-on-surface-variant opacity-60 dark:text-dark-on-surface-variant',
  },
}

const DEFAULT_NODE_ICON: NodeIcon = { icon: <Database size={16} weight="regular" />, className: '' }

export function getNodeIcon(type: NodeType, isExpanded: boolean): NodeIcon {
  if (type !== 'category') return NODE_ICONS[type] ?? DEFAULT_NODE_ICON
  return {
    icon: isExpanded ? <FolderOpen size={16} weight="fill" /> : <Folder size={16} weight="fill" />,
    className: 'text-light-folder dark:text-dark-folder',
  }
}
