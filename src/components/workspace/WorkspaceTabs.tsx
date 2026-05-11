import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { WorkspaceTab } from '../../types/schema'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { UnderlineTabBar, UnderlineTab } from '../common/UnderlineTabs'
import { TextInput } from '../common/TextInput'
import { TabContextMenu } from '../shared/TabContextMenu'
import { computeHorizontalTabReorderTarget } from '../shared/use-tab-reorder'
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
  CaretLineLeftIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretLineRightIcon,
} from '@phosphor-icons/react'
import { dispatchDismissAll } from '../../lib/context-menu-events'
import { getContextMenuPortalRoot } from '../../lib/context-menu-utils'
import styles from './WorkspaceTabs.module.css'

const EMPTY_TABS: WorkspaceTab[] = []
const TAB_ICON_SIZE = 13
const TAB_ICON_WEIGHT = 'regular'
const POINTER_DRAG_THRESHOLD_PX = 4

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
  onRequestRenameTab?: (tabId: string) => void
  onRequestMoveTab?: (tabId: string, direction: 'left' | 'right') => void
  onRequestReorderTab?: (tabId: string, insertIndex: number) => void
}

function isDragHandleBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return Boolean(
    target.closest(
      'button,input,textarea,select,[contenteditable="true"],[data-tab-drag-ignore="true"]'
    )
  )
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

export function WorkspaceTabs({
  connectionId,
  onRequestRenameTab,
  onRequestMoveTab,
  onRequestReorderTab,
}: WorkspaceTabsProps) {
  const tabs = useWorkspaceStore((state) => state.tabsByConnection[connectionId] ?? EMPTY_TABS)
  const activeTabId = useWorkspaceStore(
    (state) => state.activeTabByConnection[connectionId] ?? null
  )
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)
  const renameQueryTab = useWorkspaceStore((state) => state.renameQueryTab)
  const reorderWorkspaceTab = useWorkspaceStore((state) => state.reorderWorkspaceTab)
  const activeTabIdRef = useRef<string | null>(activeTabId)
  const suppressNextSelectRef = useRef(false)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const skipNextRenameBlurCommitRef = useRef(false)
  const [contextMenu, setContextMenu] = useState<{
    tabId: string
    x: number
    y: number
    portalRoot: HTMLElement
    invokerTabId: string
  } | null>(null)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    tabId: string
    indicator: 'before' | 'after'
  } | null>(null)
  const pointerDragRef = useRef<{
    tabId: string
    dragging: boolean
    startX: number
    startY: number
    insertIndex: number | null
  } | null>(null)
  const removePointerListenersRef = useRef<(() => void) | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const scrollableTabs = tabs.filter((t) => t.type !== 'history' && t.type !== 'processlist')
  const pinnedTabs = tabs.filter((t) => t.type === 'history' || t.type === 'processlist')
  const movableTabIds = useMemo(() => scrollableTabs.map((tab) => tab.id), [scrollableTabs])
  const contextMenuTabIndex = contextMenu
    ? movableTabIds.findIndex((tabId) => tabId === contextMenu.tabId)
    : -1
  const contextMenuTab = contextMenu
    ? (tabs.find((tab) => tab.id === contextMenu.tabId) ?? null)
    : null

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  useEffect(() => {
    if (!renamingTabId || !renameInputRef.current) {
      return
    }
    renameInputRef.current.focus()
    renameInputRef.current.select()
  }, [renamingTabId])

  useEffect(() => {
    return () => {
      removePointerListenersRef.current?.()
    }
  }, [])

  const focusWorkspaceTab = (tabId: string): boolean => {
    const tabEl = document.querySelector<HTMLElement>(`[data-testid="workspace-tab-${tabId}"]`)
    if (!tabEl) {
      return false
    }
    const labelButton = tabEl.querySelector<HTMLElement>('[role="button"],button')
    ;(labelButton ?? tabEl).focus()
    return true
  }

  const restoreFocusAfterAction = (invokerTabId: string | null) => {
    if (invokerTabId && focusWorkspaceTab(invokerTabId)) {
      return
    }
    if (activeTabIdRef.current) {
      focusWorkspaceTab(activeTabIdRef.current)
    }
  }

  const clearPointerDrag = () => {
    removePointerListenersRef.current?.()
    removePointerListenersRef.current = null
    pointerDragRef.current = null
    setDraggingTabId(null)
    setDropTarget(null)
  }

  const finishPointerDrag = (shouldCommit: boolean) => {
    const dragState = pointerDragRef.current
    const shouldSuppressSelect = Boolean(dragState?.dragging)
    if (shouldCommit && dragState?.dragging && dragState.insertIndex != null) {
      if (onRequestReorderTab) {
        onRequestReorderTab(dragState.tabId, dragState.insertIndex)
      } else {
        reorderWorkspaceTab(connectionId, dragState.tabId, dragState.insertIndex)
      }
    }
    clearPointerDrag()
    if (shouldSuppressSelect) {
      suppressNextSelectRef.current = true
      window.setTimeout(() => {
        suppressNextSelectRef.current = false
      }, 0)
    }
  }

  const findHoveredMovableTab = (clientX: number, clientY: number) => {
    for (const tabId of movableTabIds) {
      const element = document.querySelector<HTMLElement>(`[data-testid="workspace-tab-${tabId}"]`)
      if (!element) {
        continue
      }
      const rect = element.getBoundingClientRect()
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return { tabId, rect }
      }
    }
    return null
  }

  const startPointerDrag = (tabId: string, isPinned: boolean, event: PointerEvent<HTMLElement>) => {
    if (isPinned || event.button !== 0 || isDragHandleBlocked(event.target)) {
      return
    }
    event.preventDefault()
    clearPointerDrag()
    pointerDragRef.current = {
      tabId,
      dragging: false,
      startX: event.clientX,
      startY: event.clientY,
      insertIndex: null,
    }

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const dragState = pointerDragRef.current
      if (!dragState) {
        return
      }
      if (!dragState.dragging) {
        const deltaX = moveEvent.clientX - dragState.startX
        const deltaY = moveEvent.clientY - dragState.startY
        if (Math.hypot(deltaX, deltaY) < POINTER_DRAG_THRESHOLD_PX) {
          return
        }
        dragState.dragging = true
        setDraggingTabId(dragState.tabId)
      }

      const hoveredTab = findHoveredMovableTab(moveEvent.clientX, moveEvent.clientY)
      if (!hoveredTab) {
        dragState.insertIndex = null
        setDropTarget(null)
        return
      }

      const draggingIndex = movableTabIds.findIndex((id) => id === dragState.tabId)
      const targetIndex = movableTabIds.findIndex((id) => id === hoveredTab.tabId)
      const target = computeHorizontalTabReorderTarget({
        draggingIndex,
        targetIndex,
        pointerClientX: moveEvent.clientX,
        targetRect: hoveredTab.rect,
      })

      if (!target) {
        dragState.insertIndex = null
        setDropTarget(null)
        return
      }

      dragState.insertIndex = target.insertIndex
      setDropTarget({ tabId: hoveredTab.tabId, indicator: target.indicator })
    }

    const handlePointerUp = () => finishPointerDrag(true)
    const handlePointerCancel = () => finishPointerDrag(false)

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    removePointerListenersRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }

  const startRename = (tabId: string) => {
    const tab = tabs.find((candidate) => candidate.id === tabId)
    if (!tab || tab.type !== 'query-editor') {
      return
    }
    setRenamingTabId(tabId)
    setRenameDraft(tab.label)
    if (onRequestRenameTab) {
      onRequestRenameTab(tabId)
    }
  }

  const stopRename = (invokerTabId: string | null, shouldCommit: boolean) => {
    const targetTabId = renamingTabId
    const draft = renameDraft
    setRenamingTabId(null)
    setRenameDraft('')
    if (shouldCommit && targetTabId) {
      renameQueryTab(connectionId, targetTabId, draft)
    }
    restoreFocusAfterAction(invokerTabId)
  }

  const openTabContextMenu = (
    tabId: string,
    x: number,
    y: number,
    anchor: Element | null,
    invokerTabId: string
  ) => {
    dispatchDismissAll()
    setContextMenu({
      tabId,
      x,
      y,
      portalRoot: getContextMenuPortalRoot(anchor),
      invokerTabId,
    })
  }

  const renderTab = (tab: WorkspaceTab) => {
    const isActive = tab.id === activeTabId
    const isDragSource = draggingTabId === tab.id
    const dropIndicator = dropTarget?.tabId === tab.id ? dropTarget.indicator : undefined
    const isRenaming = renamingTabId === tab.id
    const isPinned = tab.type === 'history' || tab.type === 'processlist'
    return (
      <UnderlineTab
        key={tab.id}
        active={isActive}
        className={styles.workspaceTab}
        data-testid={`workspace-tab-${tab.id}`}
        onSelect={() => {
          if (suppressNextSelectRef.current) {
            return
          }
          setActiveTab(connectionId, tab.id)
        }}
        onPointerDown={(event) => startPointerDrag(tab.id, isPinned, event)}
        onContextMenu={(e) => {
          e.preventDefault()
          openTabContextMenu(tab.id, e.clientX, e.clientY, e.currentTarget, tab.id)
        }}
        onKeyDown={(e) => {
          if (e.key === 'F2') {
            e.preventDefault()
            startRename(tab.id)
            return
          }
          if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) {
            return
          }
          e.preventDefault()
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          openTabContextMenu(tab.id, rect.left, rect.bottom, e.currentTarget, tab.id)
        }}
        dragging={isDragSource}
        dropIndicator={dropIndicator}
        onAuxClick={
          !isPinned
            ? (e) => {
                if (e.button !== 1) return
                e.preventDefault()
                closeTab(connectionId, tab.id)
              }
            : undefined
        }
        suffix={
          !isPinned ? (
            <button
              type="button"
              className={styles.tabClose}
              aria-label={`Close ${tab.label}`}
              draggable={false}
              data-tab-drag-ignore="true"
              tabIndex={-1}
              onMouseDown={(e) => e.stopPropagation()}
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
        <span
          className={styles.tabLabelRoot}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startRename(tab.id)
          }}
        >
          {isRenaming ? (
            <TextInput
              ref={renameInputRef}
              value={renameDraft}
              className={styles.renameInput}
              variant="bare"
              data-testid="workspace-tab-rename-input"
              data-tab-drag-ignore="true"
              aria-label={`Rename ${tab.label}`}
              onChange={(e) => setRenameDraft(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
              onBlur={() => {
                if (skipNextRenameBlurCommitRef.current) {
                  skipNextRenameBlurCommitRef.current = false
                  return
                }
                stopRename(tab.id, true)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  skipNextRenameBlurCommitRef.current = true
                  stopRename(tab.id, true)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  skipNextRenameBlurCommitRef.current = true
                  stopRename(tab.id, false)
                }
              }}
            />
          ) : (
            <WorkspaceTabLabel tab={tab} />
          )}
        </span>
      </UnderlineTab>
    )
  }

  const contextMenuItems = contextMenu
    ? [
        {
          key: 'rename',
          label: 'Rename',
          icon: <PencilSimpleIcon size={14} weight="regular" />,
          disabled: contextMenuTab?.type !== 'query-editor',
          onSelect: () => startRename(contextMenu.tabId),
        },
        {
          key: 'move-start',
          label: 'Move to Start',
          icon: <CaretLineLeftIcon size={14} weight="regular" />,
          disabled: contextMenuTabIndex <= 0,
          onSelect: () => {
            if (onRequestReorderTab) {
              onRequestReorderTab(contextMenu.tabId, 0)
              return
            }
            reorderWorkspaceTab(connectionId, contextMenu.tabId, 0)
          },
        },
        {
          key: 'move-left',
          label: 'Move Left',
          icon: <CaretLeftIcon size={14} weight="regular" />,
          disabled: contextMenuTabIndex <= 0,
          onSelect: () => {
            if (onRequestMoveTab) {
              onRequestMoveTab(contextMenu.tabId, 'left')
              return
            }
            reorderWorkspaceTab(connectionId, contextMenu.tabId, contextMenuTabIndex - 1)
          },
        },
        {
          key: 'move-right',
          label: 'Move Right',
          icon: <CaretRightIcon size={14} weight="regular" />,
          disabled: contextMenuTabIndex < 0 || contextMenuTabIndex >= movableTabIds.length - 1,
          onSelect: () => {
            if (onRequestMoveTab) {
              onRequestMoveTab(contextMenu.tabId, 'right')
              return
            }
            reorderWorkspaceTab(connectionId, contextMenu.tabId, contextMenuTabIndex + 2)
          },
        },
        {
          key: 'move-end',
          label: 'Move to End',
          icon: <CaretLineRightIcon size={14} weight="regular" />,
          disabled: contextMenuTabIndex < 0 || contextMenuTabIndex >= movableTabIds.length - 1,
          onSelect: () => {
            if (onRequestReorderTab) {
              onRequestReorderTab(contextMenu.tabId, movableTabIds.length)
              return
            }
            reorderWorkspaceTab(connectionId, contextMenu.tabId, movableTabIds.length)
          },
        },
      ]
    : []

  return (
    <>
      <UnderlineTabBar
        className={styles.workspaceTabRailBleed}
        data-testid="workspace-tabs"
        scrollable
        suffix={
          <>
            {pinnedTabs.map(renderTab)}
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
          </>
        }
      >
        {scrollableTabs.map(renderTab)}
      </UnderlineTabBar>
      {contextMenu && (
        <TabContextMenu
          visible
          x={contextMenu.x}
          y={contextMenu.y}
          portalRoot={contextMenu.portalRoot}
          items={contextMenuItems}
          onClose={() => {
            const invokerTabId = contextMenu.invokerTabId
            setContextMenu(null)
            restoreFocusAfterAction(invokerTabId)
          }}
        />
      )}
    </>
  )
}
