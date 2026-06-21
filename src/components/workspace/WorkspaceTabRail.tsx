/**
 * WorkspaceTabRail
 *
 * Reusable component that handles core workspace tab rendering behavior for one
 * "visible group" of tabs. Placement wrappers (WorkspaceTabs for the top rail,
 * and future bottom-panel rails) own:
 *   - Which tabs belong in the visible group (filtering)
 *   - Surrounding chrome (pinned tabs, new-tab button, scrollable container)
 *   - Placement-specific styling
 *
 * WorkspaceTabRail owns:
 *   - Per-tab label/icon/dirty-indicator rendering
 *   - Tab activation on click
 *   - Middle-click close
 *   - Pointer-based drag-to-reorder (with safe subset reorder translation)
 *   - Context menu per tab (rename, move left/right/start/end)
 *   - Keyboard: Enter/Space activation, F2 rename, Shift+F10/ContextMenu key
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { WorkspaceTab } from '../../types/schema'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { UnderlineTab } from '../common/UnderlineTabs'
import { TextInput } from '../common/TextInput'
import { TabContextMenu } from '../shared/TabContextMenu'
import { computeHorizontalTabReorderTarget } from '../shared/use-tab-reorder'
import {
  PencilSimpleIcon,
  CaretLineLeftIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretLineRightIcon,
} from '@phosphor-icons/react'
import { dispatchDismissAll } from '../../lib/context-menu-events'
import { getContextMenuPortalRoot } from '../../lib/context-menu-utils'
import { getWorkspaceTabIconDescriptor } from './workspace-tab-icons'
import styles from './WorkspaceTabs.module.css'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAB_ICON_SIZE = 13
const TAB_ICON_WEIGHT = 'regular'
const POINTER_DRAG_THRESHOLD_PX = 4

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WorkspaceTabRailProps {
  /**
   * The connection that owns these tabs.
   */
  connectionId: string

  /**
   * The filtered set of tabs to render in this rail (the "visible group").
   * The rail renders exactly these tabs in order.
   */
  tabs: WorkspaceTab[]

  /**
   * The full ordered list of movable (non-pinned) tab IDs for the connection.
   * Used to translate subset reorder operations back into full-list indices
   * so that safe subset reordering does not disturb tabs outside this group.
   */
  allMovableTabIds: string[]

  /**
   * The currently active tab ID (may be a tab outside this visible group).
   */
  activeTabId: string | null
  autoScrollOnActive?: boolean

  /**
   * Called when a tab rename is requested (e.g. F2 / double-click).
   * If provided, the caller is notified before the inline rename begins.
   */
  onRequestRenameTab?: (tabId: string) => void

  /**
   * Called when a "move left" / "move right" context menu action is triggered.
   * When provided this overrides the default workspace store reorder action.
   */
  onRequestMoveTab?: (tabId: string, direction: 'left' | 'right') => void

  /**
   * Called when a drag-reorder or context menu move action resolves.
   * The insertIndex is relative to allMovableTabIds (full movable list).
   * When provided this overrides the default workspace store reorder action.
   */
  onRequestReorderTab?: (tabId: string, insertIndex: number) => void
  onFocusOwningStackChip?: () => void
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// WorkspaceTabLabel (sub-component)
// ---------------------------------------------------------------------------

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
  const { IconComponent, testId } = getWorkspaceTabIconDescriptor(tab)
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

// ---------------------------------------------------------------------------
// WorkspaceTabRail (main export)
// ---------------------------------------------------------------------------

export function WorkspaceTabRail({
  connectionId,
  tabs,
  allMovableTabIds,
  activeTabId,
  autoScrollOnActive = true,
  onRequestRenameTab,
  onRequestMoveTab,
  onRequestReorderTab,
  onFocusOwningStackChip,
}: WorkspaceTabRailProps) {
  const requestActivateTab = useWorkspaceStore((state) => state.requestActivateTab)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const renameQueryTab = useWorkspaceStore((state) => state.renameQueryTab)
  const reorderWorkspaceTab = useWorkspaceStore((state) => state.reorderWorkspaceTab)

  const activeTabIdRef = useRef<string | null>(activeTabId)
  const suppressNextSelectRef = useRef(false)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const skipNextRenameBlurCommitRef = useRef(false)
  const railRef = useRef<HTMLDivElement | null>(null)

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

  // The tab IDs visible in this rail (in order)
  const visibleTabIds = useMemo(() => tabs.map((t) => t.id), [tabs])

  // The context menu tab's index within the visible group (for move enabled/disabled state)
  const contextMenuVisibleIndex = contextMenu
    ? visibleTabIds.findIndex((id) => id === contextMenu.tabId)
    : -1
  const contextMenuTab = contextMenu ? (tabs.find((t) => t.id === contextMenu.tabId) ?? null) : null

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

  // ---------------------------------------------------------------------------
  // Focus helpers
  // ---------------------------------------------------------------------------

  const focusWorkspaceTab = (tabId: string): boolean => {
    const tabEl = railRef.current?.querySelector<HTMLElement>(`[data-testid="workspace-tab-${tabId}"]`)
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

  // ---------------------------------------------------------------------------
  // Safe subset reorder: translate visible-group index → allMovableTabIds index
  //
  // When this rail shows a filtered subset of all movable tabs, dragging tab A
  // before tab B (within the subset) must not disturb unrelated movable tabs.
  // Strategy: for a given subset insertIndex, find the full-list position by
  // looking at the neighbours in the visible group and inserting relative to
  // them in the full list.
  // ---------------------------------------------------------------------------

  /**
   * Given an insertIndex relative to the visible group (visibleTabIds), returns
   * the insertIndex relative to allMovableTabIds (the full movable list).
   *
   * Examples (subset = [A, C], full = [A, B, C, D]):
   *   subsetInsert=0 → fullInsert=0  (before A)
   *   subsetInsert=1 → fullInsert=2  (after A, before B = slot between A and C)
   *   subsetInsert=2 → fullInsert=3  (after C, before D)
   */
  const translateSubsetInsertIndex = (subsetInsertIndex: number): number => {
    // If the visible set IS the full movable set there's nothing to translate
    if (visibleTabIds.length === allMovableTabIds.length) {
      return subsetInsertIndex
    }

    if (subsetInsertIndex <= 0) {
      // Insert before the first visible tab — find its full-list position
      const firstVisibleId = visibleTabIds[0]
      if (!firstVisibleId) {
        return 0
      }
      const fullIdx = allMovableTabIds.indexOf(firstVisibleId)
      return fullIdx >= 0 ? fullIdx : 0
    }

    if (subsetInsertIndex >= visibleTabIds.length) {
      // Insert after the last visible tab — find its full-list position + 1
      const lastVisibleId = visibleTabIds[visibleTabIds.length - 1]
      if (!lastVisibleId) {
        return allMovableTabIds.length
      }
      const fullIdx = allMovableTabIds.indexOf(lastVisibleId)
      return fullIdx >= 0 ? fullIdx + 1 : allMovableTabIds.length
    }

    // Insert between subset[subsetInsertIndex-1] and subset[subsetInsertIndex].
    // We want to place the tab right before subset[subsetInsertIndex] in the full list.
    const beforeId = visibleTabIds[subsetInsertIndex]
    const fullIdx = allMovableTabIds.indexOf(beforeId)
    return fullIdx >= 0 ? fullIdx : subsetInsertIndex
  }

  // ---------------------------------------------------------------------------
  // Pointer drag / reorder
  // ---------------------------------------------------------------------------

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
      // insertIndex is currently in visible-group space; translate to full-list space
      const fullInsertIndex = translateSubsetInsertIndex(dragState.insertIndex)
      if (onRequestReorderTab) {
        onRequestReorderTab(dragState.tabId, fullInsertIndex)
      } else {
        reorderWorkspaceTab(connectionId, dragState.tabId, fullInsertIndex)
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

  const findHoveredVisibleTab = (clientX: number, clientY: number) => {
    for (const tabId of visibleTabIds) {
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

      const hoveredTab = findHoveredVisibleTab(moveEvent.clientX, moveEvent.clientY)
      if (!hoveredTab) {
        dragState.insertIndex = null
        setDropTarget(null)
        return
      }

      // Compute drag target in visible-group index space
      const draggingIndex = visibleTabIds.findIndex((id) => id === dragState.tabId)
      const targetIndex = visibleTabIds.findIndex((id) => id === hoveredTab.tabId)
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

  // ---------------------------------------------------------------------------
  // Rename
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Context menu
  // ---------------------------------------------------------------------------

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

  // Build context menu items when a menu is open
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
          disabled: contextMenuVisibleIndex <= 0,
          onSelect: () => {
            const fullInsert = translateSubsetInsertIndex(0)
            if (onRequestReorderTab) {
              onRequestReorderTab(contextMenu.tabId, fullInsert)
              return
            }
            reorderWorkspaceTab(connectionId, contextMenu.tabId, fullInsert)
          },
        },
        {
          key: 'move-left',
          label: 'Move Left',
          icon: <CaretLeftIcon size={14} weight="regular" />,
          disabled: contextMenuVisibleIndex <= 0,
          onSelect: () => {
            if (onRequestMoveTab) {
              onRequestMoveTab(contextMenu.tabId, 'left')
              return
            }
            // Translate: move one slot left in the visible group → full list
            const fullInsert = translateSubsetInsertIndex(contextMenuVisibleIndex - 1)
            reorderWorkspaceTab(connectionId, contextMenu.tabId, fullInsert)
          },
        },
        {
          key: 'move-right',
          label: 'Move Right',
          icon: <CaretRightIcon size={14} weight="regular" />,
          disabled:
            contextMenuVisibleIndex < 0 || contextMenuVisibleIndex >= visibleTabIds.length - 1,
          onSelect: () => {
            if (onRequestMoveTab) {
              onRequestMoveTab(contextMenu.tabId, 'right')
              return
            }
            // Translate: move one slot right in the visible group → full list
            const fullInsert = translateSubsetInsertIndex(contextMenuVisibleIndex + 2)
            reorderWorkspaceTab(connectionId, contextMenu.tabId, fullInsert)
          },
        },
        {
          key: 'move-end',
          label: 'Move to End',
          icon: <CaretLineRightIcon size={14} weight="regular" />,
          disabled:
            contextMenuVisibleIndex < 0 || contextMenuVisibleIndex >= visibleTabIds.length - 1,
          onSelect: () => {
            const fullInsert = translateSubsetInsertIndex(visibleTabIds.length)
            if (onRequestReorderTab) {
              onRequestReorderTab(contextMenu.tabId, fullInsert)
              return
            }
            reorderWorkspaceTab(connectionId, contextMenu.tabId, fullInsert)
          },
        },
      ]
    : []

  // ---------------------------------------------------------------------------
  // Render individual tab
  // ---------------------------------------------------------------------------

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
        autoScrollOnActive={autoScrollOnActive}
        className={styles.workspaceTab}
        data-testid={`workspace-tab-${tab.id}`}
        onSelect={() => {
          if (suppressNextSelectRef.current) {
            return
          }
          requestActivateTab(tab.id)
        }}
        onPointerDown={(event) => startPointerDrag(tab.id, isPinned, event)}
        onContextMenu={(e) => {
          e.preventDefault()
          openTabContextMenu(tab.id, e.clientX, e.clientY, e.currentTarget, tab.id)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            onFocusOwningStackChip?.()
            return
          }
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div ref={railRef} className={styles.workspaceTabRailGroup}>
      {tabs.map(renderTab)}
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
    </div>
  )
}
