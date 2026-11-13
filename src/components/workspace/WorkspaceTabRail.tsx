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
 *   - Context menu per tab (rename, move left/right/start/end, close to the left/right)
 *   - Keyboard: Enter/Space activation, F2 rename, Shift+F10/ContextMenu key
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { ShortcutBinding, WorkspaceTab } from '../../types/schema'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useShortcutStore } from '../../stores/shortcut-store'
import { UnderlineTab } from '../common/UnderlineTabs'
import { TextInput } from '../common/TextInput'
import { IconButton } from '../common/IconButton'
import { TabContextMenu, type TabContextMenuItem } from '../shared/TabContextMenu'
import { usePointerTabDrag } from '../shared/use-pointer-tab-drag'
import {
  ArrowLineLeftIcon,
  ArrowLineRightIcon,
  PencilSimpleIcon,
  CaretLineLeftIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretLineRightIcon,
  CrosshairIcon,
  XIcon,
} from '@phosphor-icons/react'
import { dispatchDismissAll } from '../../lib/context-menu-events'
import {
  getTabRevealTarget,
  isObjectTab,
  revealTabInObjectBrowser,
} from '../../lib/object-activation'
import { shortcutLabelParts } from '../../lib/shortcut-labels'
import { getContextMenuPortalRoot } from '../../lib/context-menu-utils'
import type { ContextMenuOpenPoint } from '../../lib/context-menu-utils'
import { getWorkspaceTabIconDescriptor } from './workspace-tab-icons'
import styles from './WorkspaceTabs.module.css'
import { isPinnedWorkspaceTab } from '../../lib/workspace-tab-stacks'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAB_ICON_SIZE = 16
const TAB_ICON_WEIGHT = 'regular'
const MOVE_ONE_SLOT_RIGHT_INSERT_OFFSET = 2
const WORKSPACE_TAB_TEST_ID_PREFIX = 'workspace-tab-'

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
  onFocusGroupRail?: () => void
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

interface TabIdLists {
  visibleTabIds: string[]
  allMovableTabIds: string[]
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
function translateSubsetInsertIndex(tabIdLists: TabIdLists, subsetInsertIndex: number): number {
  const { visibleTabIds, allMovableTabIds } = tabIdLists
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
    const fullIndex = allMovableTabIds.indexOf(firstVisibleId)
    return fullIndex >= 0 ? fullIndex : 0
  }

  if (subsetInsertIndex >= visibleTabIds.length) {
    // Insert after the last visible tab — find its full-list position + 1
    const lastVisibleId = visibleTabIds[visibleTabIds.length - 1]
    if (!lastVisibleId) {
      return allMovableTabIds.length
    }
    const fullIndex = allMovableTabIds.indexOf(lastVisibleId)
    return fullIndex >= 0 ? fullIndex + 1 : allMovableTabIds.length
  }

  // Insert between subset[subsetInsertIndex-1] and subset[subsetInsertIndex].
  // We want to place the tab right before subset[subsetInsertIndex] in the full list.
  const beforeId = visibleTabIds[subsetInsertIndex]
  const fullIndex = allMovableTabIds.indexOf(beforeId)
  return fullIndex >= 0 ? fullIndex : subsetInsertIndex
}

interface TabContextMenuState {
  tabId: string
  x: number
  y: number
  portalRoot: HTMLElement
  invokerTabId: string
}

interface TabMenuTarget {
  tab: WorkspaceTab | null
  visibleIndex: number
  visibleTabIds: string[]
  revealShortcut: string | undefined
}

interface TabMenuActions {
  rename: () => void
  moveToVisibleSlot: (visibleInsertIndex: number) => void
  moveOneSlot: (direction: 'left' | 'right') => void
  closeTabs: (tabIds: string[]) => void
}

function findTabById(tabs: WorkspaceTab[], tabId: string): WorkspaceTab | null {
  return tabs.find((tab) => tab.id === tabId) ?? null
}

function revealShortcutLabel(binding: ShortcutBinding | null): string | undefined {
  if (!binding?.key) return undefined
  return shortcutLabelParts(binding).join(' ')
}

// "Reveal in object browser" applies to tabs that show a database object;
// it is disabled for create-mode tabs whose object does not exist yet.
function revealMenuItems(target: TabMenuTarget): TabContextMenuItem[] {
  const { tab } = target
  if (!tab) return []
  if (!isObjectTab(tab)) return []
  return [
    {
      key: 'reveal-in-object-browser',
      label: 'Reveal in object browser',
      icon: <CrosshairIcon size={14} weight="regular" />,
      shortcut: target.revealShortcut,
      disabled: getTabRevealTarget(tab) === null,
      separatorAfter: true,
      onSelect: () => {
        void revealTabInObjectBrowser(tab)
      },
    },
  ]
}

function isLastOrOutsideVisibleGroup(target: TabMenuTarget): boolean {
  return target.visibleIndex < 0 || target.visibleIndex >= target.visibleTabIds.length - 1
}

function buildTabMenuItems(target: TabMenuTarget, actions: TabMenuActions): TabContextMenuItem[] {
  const { visibleIndex, visibleTabIds } = target
  const isFirstVisible = visibleIndex <= 0
  const isLastVisible = isLastOrOutsideVisibleGroup(target)
  return [
    ...revealMenuItems(target),
    {
      key: 'rename',
      label: 'Rename',
      icon: <PencilSimpleIcon size={14} weight="regular" />,
      disabled: target.tab?.type !== 'query-editor',
      onSelect: actions.rename,
    },
    {
      key: 'move-start',
      label: 'Move to start',
      icon: <CaretLineLeftIcon size={14} weight="regular" />,
      disabled: isFirstVisible,
      onSelect: () => actions.moveToVisibleSlot(0),
    },
    {
      key: 'move-left',
      label: 'Move left',
      icon: <CaretLeftIcon size={14} weight="regular" />,
      disabled: isFirstVisible,
      onSelect: () => actions.moveOneSlot('left'),
    },
    {
      key: 'move-right',
      label: 'Move right',
      icon: <CaretRightIcon size={14} weight="regular" />,
      disabled: isLastVisible,
      onSelect: () => actions.moveOneSlot('right'),
    },
    {
      key: 'move-end',
      label: 'Move to end',
      icon: <CaretLineRightIcon size={14} weight="regular" />,
      disabled: isLastVisible,
      onSelect: () => actions.moveToVisibleSlot(visibleTabIds.length),
    },
    {
      key: 'close-left',
      label: 'Close tabs to the left',
      icon: <ArrowLineLeftIcon size={14} weight="regular" />,
      disabled: isFirstVisible,
      onSelect: () => actions.closeTabs(visibleTabIds.slice(0, visibleIndex)),
    },
    {
      key: 'close-right',
      label: 'Close tabs to the right',
      icon: <ArrowLineRightIcon size={14} weight="regular" />,
      disabled: isLastVisible,
      onSelect: () => actions.closeTabs(visibleTabIds.slice(visibleIndex + 1)),
    },
  ]
}

const VISIBLE_SLOT_OFFSET_FOR_DIRECTION: Record<'left' | 'right', number> = {
  left: -1,
  right: MOVE_ONE_SLOT_RIGHT_INSERT_OFFSET,
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
  onFocusGroupRail,
}: WorkspaceTabRailProps) {
  const requestActivateTab = useWorkspaceStore((state) => state.requestActivateTab)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const renameQueryTab = useWorkspaceStore((state) => state.renameQueryTab)
  const reorderWorkspaceTab = useWorkspaceStore((state) => state.reorderWorkspaceTab)

  const activeTabIdRef = useRef<string | null>(activeTabId)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const skipNextRenameBlurCommitRef = useRef(false)
  const railRef = useRef<HTMLDivElement | null>(null)

  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  // The tab IDs visible in this rail (in order)
  const visibleTabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs])

  const revealBinding = useShortcutStore(
    (state) => state.shortcuts['reveal-in-object-browser'] ?? null
  )

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  useEffect(() => {
    const renameInput = renameInputRef.current
    if (!renamingTabId) return
    if (!renameInput) return
    renameInput.focus()
    renameInput.select()
  }, [renamingTabId])

  // ---------------------------------------------------------------------------
  // Focus helpers
  // ---------------------------------------------------------------------------

  const focusWorkspaceTab = (tabId: string): boolean => {
    const tabElement = railRef.current?.querySelector<HTMLElement>(
      `[data-testid="${WORKSPACE_TAB_TEST_ID_PREFIX}${tabId}"]`
    )
    if (!tabElement) {
      return false
    }
    const labelButton = tabElement.querySelector<HTMLElement>('[role="button"],button')
    ;(labelButton ?? tabElement).focus()
    return true
  }

  const focusInvokerTab = (invokerTabId: string | null): boolean => {
    if (!invokerTabId) return false
    return focusWorkspaceTab(invokerTabId)
  }

  const restoreFocusAfterAction = (invokerTabId: string | null) => {
    if (focusInvokerTab(invokerTabId)) {
      return
    }
    if (activeTabIdRef.current) {
      focusWorkspaceTab(activeTabIdRef.current)
    }
  }

  const tabIdLists: TabIdLists = {
    visibleTabIds: visibleTabIds,
    allMovableTabIds: allMovableTabIds,
  }

  const commitTabReorder = (tabId: string, visibleInsertIndex: number) => {
    const fullInsertIndex = translateSubsetInsertIndex(tabIdLists, visibleInsertIndex)
    if (onRequestReorderTab) {
      onRequestReorderTab(tabId, fullInsertIndex)
      return
    }
    reorderWorkspaceTab(connectionId, tabId, fullInsertIndex)
  }

  const { draggingTabId, dropIndicatorFor, startPointerDrag, isSelectSuppressed } =
    usePointerTabDrag({
      tabIds: visibleTabIds,
      tabTestIdPrefix: WORKSPACE_TAB_TEST_ID_PREFIX,
      onReorder: commitTabReorder,
    })

  const startTabPointerDrag = (
    tabId: string,
    isPinned: boolean,
    event: PointerEvent<HTMLElement>
  ) => {
    if (isPinned) {
      return
    }
    startPointerDrag(tabId, event)
  }

  // ---------------------------------------------------------------------------
  // Rename
  // ---------------------------------------------------------------------------

  const startRename = (tabId: string) => {
    const tab = tabs.find((candidate) => candidate.id === tabId)
    if (!tab) return
    if (tab.type !== 'query-editor') return
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

  const openTabContextMenu = (tabId: string, { x, y, anchor }: ContextMenuOpenPoint) => {
    dispatchDismissAll()
    setContextMenu({
      tabId: tabId,
      x: x,
      y: y,
      portalRoot: getContextMenuPortalRoot(anchor),
      invokerTabId: tabId,
    })
  }

  const buildContextMenuItems = (menu: TabContextMenuState): TabContextMenuItem[] => {
    const visibleIndex = visibleTabIds.indexOf(menu.tabId)
    const target: TabMenuTarget = {
      tab: findTabById(tabs, menu.tabId),
      visibleIndex: visibleIndex,
      visibleTabIds: visibleTabIds,
      revealShortcut: revealShortcutLabel(revealBinding),
    }
    return buildTabMenuItems(target, {
      rename: () => startRename(menu.tabId),
      moveToVisibleSlot: (visibleInsertIndex) => commitTabReorder(menu.tabId, visibleInsertIndex),
      moveOneSlot: (direction) => {
        if (onRequestMoveTab) {
          onRequestMoveTab(menu.tabId, direction)
          return
        }
        const visibleInsertIndex = visibleIndex + VISIBLE_SLOT_OFFSET_FOR_DIRECTION[direction]
        const fullInsert = translateSubsetInsertIndex(tabIdLists, visibleInsertIndex)
        reorderWorkspaceTab(connectionId, menu.tabId, fullInsert)
      },
      closeTabs: (tabIds) => {
        for (const id of tabIds) {
          closeTab(connectionId, id)
        }
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Render individual tab
  // ---------------------------------------------------------------------------

  const renderTab = (tab: WorkspaceTab) => {
    const isActive = tab.id === activeTabId
    const isDragSource = draggingTabId === tab.id
    const dropIndicator = dropIndicatorFor(tab.id)
    const isRenaming = renamingTabId === tab.id
    const isPinned = isPinnedWorkspaceTab(tab)
    return (
      <UnderlineTab
        key={tab.id}
        variant="document"
        active={isActive}
        autoScrollOnActive={autoScrollOnActive}
        className={styles.workspaceTab}
        data-testid={`${WORKSPACE_TAB_TEST_ID_PREFIX}${tab.id}`}
        onSelect={() => {
          if (isSelectSuppressed()) {
            return
          }
          requestActivateTab(tab.id)
        }}
        onPointerDown={(event) => startTabPointerDrag(tab.id, isPinned, event)}
        onContextMenu={(event) => {
          event.preventDefault()
          openTabContextMenu(tab.id, {
            x: event.clientX,
            y: event.clientY,
            anchor: event.currentTarget,
          })
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            onFocusGroupRail?.()
            return
          }
          if (event.key === 'F2') {
            event.preventDefault()
            startRename(tab.id)
            return
          }
          const isShiftF10 = event.shiftKey && event.key === 'F10'
          const isContextMenuKey = event.key === 'ContextMenu' || isShiftF10
          if (!isContextMenuKey) {
            return
          }
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          openTabContextMenu(tab.id, {
            x: rect.left,
            y: rect.bottom,
            anchor: event.currentTarget,
          })
        }}
        dragging={isDragSource}
        dropIndicator={dropIndicator}
        onAuxClick={
          !isPinned
            ? (event) => {
                if (event.button !== 1) return
                event.preventDefault()
                closeTab(connectionId, tab.id)
              }
            : undefined
        }
        suffix={
          !isPinned ? (
            <IconButton
              size="sm"
              className={styles.tabClose}
              aria-label={`Close ${tab.label}`}
              draggable={false}
              data-tab-drag-ignore="true"
              tabIndex={-1}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                closeTab(connectionId, tab.id)
              }}
            >
              <XIcon size={16} weight="regular" aria-hidden />
            </IconButton>
          ) : undefined
        }
      >
        <span
          className={styles.tabLabelRoot}
          onDoubleClick={(event) => {
            event.stopPropagation()
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
              onChange={(event) => setRenameDraft(event.target.value)}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.stopPropagation()}
              onBlur={() => {
                if (skipNextRenameBlurCommitRef.current) {
                  skipNextRenameBlurCommitRef.current = false
                  return
                }
                stopRename(tab.id, true)
              }}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') {
                  event.preventDefault()
                  skipNextRenameBlurCommitRef.current = true
                  stopRename(tab.id, true)
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
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
          items={buildContextMenuItems(contextMenu)}
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
