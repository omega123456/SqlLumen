import type { ComponentType } from 'react'
import type { WorkspaceTab } from '../../types/schema'
import type { WorkspaceTabStackKey } from '../../lib/workspace-tab-stacks'
import {
  CalendarBlankIcon,
  ClockCounterClockwiseIcon,
  CodeIcon,
  EyeIcon,
  FileTextIcon,
  GearIcon,
  LightningIcon,
  ListBulletsIcon,
  MathOperationsIcon,
  PencilSimpleIcon,
  StackIcon,
  TableIcon,
} from '@phosphor-icons/react'

export type WorkspaceIconComponent = ComponentType<{
  size?: number | string
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
  className?: string
  'aria-hidden'?: boolean
  'data-testid'?: string
}>

const TAB_ICON_BY_TYPE: Partial<Record<WorkspaceTab['type'], WorkspaceIconComponent>> = {
  'schema-info': FileTextIcon,
  'table-data': TableIcon,
  'query-editor': CodeIcon,
  'table-designer': PencilSimpleIcon,
  history: ClockCounterClockwiseIcon,
  processlist: ListBulletsIcon,
}

const OBJECT_EDITOR_ICON_BY_TYPE: Record<
  Extract<WorkspaceTab, { type: 'object-editor' }>['objectType'],
  WorkspaceIconComponent
> = {
  view: EyeIcon,
  procedure: GearIcon,
  function: MathOperationsIcon,
  trigger: LightningIcon,
  event: CalendarBlankIcon,
}

const STACK_ICON_BY_KEY: Record<WorkspaceTabStackKey, WorkspaceIconComponent> = {
  queries: CodeIcon,
  tables: TableIcon,
  designers: PencilSimpleIcon,
  schema: FileTextIcon,
  objects: StackIcon,
}

export function getWorkspaceTabIconDescriptor(tab: WorkspaceTab): {
  IconComponent: WorkspaceIconComponent
  testId: string
} {
  if (tab.type === 'object-editor') {
    return {
      IconComponent: OBJECT_EDITOR_ICON_BY_TYPE[tab.objectType],
      testId: `workspace-tab-icon-object-editor-${tab.objectType}`,
    }
  }

  const icon = TAB_ICON_BY_TYPE[tab.type]
  if (icon) {
    return {
      IconComponent: icon,
      testId: `workspace-tab-icon-${tab.type}`,
    }
  }

  return {
    IconComponent: FileTextIcon,
    testId: 'workspace-tab-icon-default',
  }
}

export function getWorkspaceStackIconDescriptor(stackKey: WorkspaceTabStackKey): {
  IconComponent: WorkspaceIconComponent
  testId: string
} {
  return {
    IconComponent: STACK_ICON_BY_KEY[stackKey],
    testId: `workspace-stack-icon-${stackKey}`,
  }
}
