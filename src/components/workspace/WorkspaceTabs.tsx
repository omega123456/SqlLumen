import type { ReactNode } from 'react'
import type { WorkspaceTab } from '../../types/schema'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { UnderlineTabBar, UnderlineTab } from '../common/UnderlineTabs'
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
  PlusIcon,
  TableIcon,
} from '@phosphor-icons/react'
import styles from './WorkspaceTabs.module.css'

const EMPTY_TABS: WorkspaceTab[] = []
const TAB_ICON_SIZE = 13
const TAB_ICON_WEIGHT = 'regular'

type TabIconComponent = React.ComponentType<{
  size?: number | string
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
  className?: string
  'aria-hidden'?: boolean
  'data-testid'?: string
}>

const TAB_ICON_BY_TYPE: Partial<Record<WorkspaceTab['type'], TabIconComponent>> = {
  'schema-info': FileTextIcon,
  'table-data': TableIcon,
  'query-editor': CodeIcon,
  'table-designer': PencilSimpleIcon,
  history: ClockCounterClockwiseIcon,
  processlist: ListBulletsIcon,
}

const OBJECT_EDITOR_ICON_BY_TYPE: Record<
  Extract<WorkspaceTab, { type: 'object-editor' }>['objectType'],
  TabIconComponent
> = {
  view: EyeIcon,
  procedure: GearIcon,
  function: MathOperationsIcon,
  trigger: LightningIcon,
  event: CalendarBlankIcon,
}

export interface WorkspaceTabsProps {
  connectionId: string
}

function getTabIconDescriptor(tab: WorkspaceTab): {
  IconComponent: TabIconComponent
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

function WorkspaceTabLabel({ tab }: { tab: WorkspaceTab }) {
  const isDesignerDirty = useTableDesignerStore((state) =>
    tab.type === 'table-designer' ? (state.tabs[tab.id]?.isDirty ?? false) : false
  )

  const isObjectEditorDirty = useObjectEditorStore((state) => {
    if (tab.type !== 'object-editor') {
      return false
    }
    const tabState = state.tabs[tab.id]
    if (!tabState) {
      return false
    }
    return tabState.content !== tabState.originalContent
  })

  const isDirty = isDesignerDirty || isObjectEditorDirty
  const { IconComponent, testId } = getTabIconDescriptor(tab)
  const leadingIcon: ReactNode = (
    <IconComponent
      size={TAB_ICON_SIZE}
      weight={TAB_ICON_WEIGHT}
      aria-hidden={true}
      data-testid={testId}
      className={styles.tabTypeIcon}
    />
  )

  return (
    <span className={styles.tabLabel}>
      {leadingIcon}
      <span className={styles.tabLabelText}>{tab.label}</span>
      {isDirty && <span className={styles.dirtyIndicator}> ●</span>}
    </span>
  )
}

export function WorkspaceTabs({ connectionId }: WorkspaceTabsProps) {
  const tabs = useWorkspaceStore((state) => state.tabsByConnection[connectionId] ?? EMPTY_TABS)
  const activeTabId = useWorkspaceStore(
    (state) => state.activeTabByConnection[connectionId] ?? null
  )
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  return (
    <UnderlineTabBar className={styles.workspaceTabRailBleed} data-testid="workspace-tabs">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <UnderlineTab
            key={tab.id}
            active={isActive}
            className={styles.workspaceTab}
            data-testid={`workspace-tab-${tab.id}`}
            onSelect={() => setActiveTab(connectionId, tab.id)}
            onAuxClick={
              tab.type !== 'history' && tab.type !== 'processlist'
                ? (e) => {
                    if (e.button !== 1) return
                    e.preventDefault()
                    closeTab(connectionId, tab.id)
                  }
                : undefined
            }
            suffix={
              tab.type !== 'history' && tab.type !== 'processlist' ? (
                <button
                  type="button"
                  className={styles.tabClose}
                  aria-label={`Close ${tab.label}`}
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(connectionId, tab.id)
                  }}
                >
                  ×
                </button>
              ) : undefined
            }
          >
            <WorkspaceTabLabel tab={tab} />
          </UnderlineTab>
        )
      })}
      {/* Always-visible "+" button to create a new query tab */}
      <button
        type="button"
        className={styles.newTabButton}
        title="New Query Tab"
        aria-label="New Query Tab"
        onClick={() => openQueryTab(connectionId)}
        data-testid="new-query-tab-button"
      >
        <PlusIcon size={16} weight="bold" />
      </button>
    </UnderlineTabBar>
  )
}
