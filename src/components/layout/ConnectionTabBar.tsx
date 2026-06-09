import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import {
  SunIcon,
  MoonIcon,
  GearSixIcon,
  ClockCounterClockwiseIcon,
  PlusIcon,
  XIcon,
  CaretLineLeftIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretLineRightIcon,
  LockIcon,
} from '@phosphor-icons/react'
import { useThemeStore } from '../../stores/theme-store'
import { normalizeActiveConnectionOrder, useConnectionStore } from '../../stores/connection-store'
import type { Theme } from '../../stores/theme-store'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import { UnderlineTabBar, UnderlineTab } from '../common/UnderlineTabs'
import { TabContextMenu } from '../shared/TabContextMenu'
import { computeHorizontalTabReorderTarget } from '../shared/use-tab-reorder'
import { dispatchDismissAll } from '../../lib/context-menu-events'
import { getContextMenuPortalRoot } from '../../lib/context-menu-utils'
import styles from './ConnectionTabBar.module.css'

const POINTER_DRAG_THRESHOLD_PX = 4

export interface ConnectionTabBarProps {
  onOpenSettings?: () => void
  onOpenSnapshots?: () => void
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

export function ConnectionTabBar({ onOpenSettings, onOpenSnapshots }: ConnectionTabBarProps) {
  const [pendingConnectionClose, setPendingConnectionClose] = useState<{
    id: string
    displayName: string
    hostPort: string
  } | null>(null)
  const [isClosingConnection, setIsClosingConnection] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string
    x: number
    y: number
    invokerTabId: string
    portalRoot: HTMLElement
  } | null>(null)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    tabId: string
    indicator: 'before' | 'after'
  } | null>(null)
  const suppressNextSelectRef = useRef(false)
  const pointerDragRef = useRef<{
    tabId: string
    dragging: boolean
    startX: number
    startY: number
    insertIndex: number | null
  } | null>(null)
  const removePointerListenersRef = useRef<(() => void) | null>(null)

  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const setTheme = useThemeStore((state) => state.setTheme)

  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeConnectionOrder = useConnectionStore((state) => state.activeConnectionOrder)
  const activeTabId = useConnectionStore((state) => state.activeTabId)
  const switchTab = useConnectionStore((state) => state.switchTab)
  const closeConnection = useConnectionStore((state) => state.closeConnection)
  const openDialog = useConnectionStore((state) => state.openDialog)
  const reorderActiveConnection = useConnectionStore((state) => state.reorderActiveConnection)
  const moveActiveConnection = useConnectionStore((state) => state.moveActiveConnection)
  const activeTabIdRef = useRef<string | null>(activeTabId)

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  useEffect(() => {
    return () => {
      removePointerListenersRef.current?.()
    }
  }, [])

  const handleThemeToggle = () => {
    const nextTheme: Theme = resolvedTheme === 'light' ? 'dark' : 'light'
    void setTheme(nextTheme)
  }

  const orderedSessionIds = useMemo(
    () => normalizeActiveConnectionOrder(activeConnectionOrder, activeConnections),
    [activeConnectionOrder, activeConnections]
  )
  const tabs = orderedSessionIds
    .map((sessionId) => activeConnections[sessionId])
    .filter((connection): connection is NonNullable<typeof connection> => Boolean(connection))
  const sessionIds = tabs.map((connection) => connection.id)
  const contextMenuTabIndex = contextMenu ? sessionIds.indexOf(contextMenu.sessionId) : -1
  const tabsByProfileId = new Map<string, typeof tabs>()
  for (const c of tabs) {
    const pid = c.profile.id
    const list = tabsByProfileId.get(pid) ?? []
    list.push(c)
    tabsByProfileId.set(pid, list)
  }
  const tabDisplayName = (c: (typeof tabs)[0]) => {
    const baseName = c.profile.name.trim() !== '' ? c.profile.name.trim() : 'Unnamed connection'
    const list = tabsByProfileId.get(c.profile.id) ?? []
    if (list.length <= 1) {
      return baseName
    }
    const idx = list.findIndex((x) => x.id === c.id) + 1
    if (idx === 1) {
      return baseName
    }
    return `${baseName} (${idx})`
  }

  const handleConfirmCloseConnection = async () => {
    if (!pendingConnectionClose) {
      return
    }
    const { id } = pendingConnectionClose
    setIsClosingConnection(true)
    try {
      await closeConnection(id)
    } finally {
      setIsClosingConnection(false)
      setPendingConnectionClose(null)
    }
  }

  const focusConnectionTab = (sessionId: string): boolean => {
    const tabEl = document.querySelector<HTMLElement>(
      `[data-testid="connection-session-tab-${sessionId}"]`
    )
    if (!tabEl) {
      return false
    }
    const labelButton = tabEl.querySelector<HTMLElement>('[role="button"],button')
    ;(labelButton ?? tabEl).focus()
    return true
  }

  const restoreFocusAfterAction = (invokerTabId: string | null) => {
    if (invokerTabId && focusConnectionTab(invokerTabId)) {
      return
    }
    if (activeTabIdRef.current) {
      focusConnectionTab(activeTabIdRef.current)
    }
  }

  const openTabContextMenu = (
    sessionId: string,
    x: number,
    y: number,
    anchor: Element | null,
    invokerTabId: string
  ) => {
    dispatchDismissAll()
    setContextMenu({
      sessionId,
      x,
      y,
      invokerTabId,
      portalRoot: getContextMenuPortalRoot(anchor),
    })
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
      reorderActiveConnection(dragState.tabId, dragState.insertIndex)
    }
    clearPointerDrag()
    if (shouldSuppressSelect) {
      suppressNextSelectRef.current = true
      window.setTimeout(() => {
        suppressNextSelectRef.current = false
      }, 0)
    }
  }

  const findHoveredSessionTab = (clientX: number, clientY: number) => {
    for (const sessionId of sessionIds) {
      const element = document.querySelector<HTMLElement>(
        `[data-testid="connection-session-tab-${sessionId}"]`
      )
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
        return { sessionId, rect }
      }
    }
    return null
  }

  const startPointerDrag = (sessionId: string, event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isDragHandleBlocked(event.target)) {
      return
    }
    event.preventDefault()
    clearPointerDrag()
    pointerDragRef.current = {
      tabId: sessionId,
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

      const hoveredTab = findHoveredSessionTab(moveEvent.clientX, moveEvent.clientY)
      if (!hoveredTab) {
        dragState.insertIndex = null
        setDropTarget(null)
        return
      }

      const draggingIndex = sessionIds.indexOf(dragState.tabId)
      const targetIndex = sessionIds.indexOf(hoveredTab.sessionId)
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
      setDropTarget({ tabId: hoveredTab.sessionId, indicator: target.indicator })
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

  return (
    <div className={styles.tabBar} data-testid="connection-tab-bar">
      <div className={styles.leftSection}>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="New Connection"
          title="New Connection"
          onClick={openDialog}
        >
          <PlusIcon size={20} weight="regular" />
        </button>
      </div>
      {tabs.length > 0 && (
        <div className={styles.tabsSection}>
          <UnderlineTabBar className={styles.connectionTabRail}>
            {tabs.map((conn) => {
              const isActive = conn.id === activeTabId
              const displayName = tabDisplayName(conn)
              return (
                <UnderlineTab
                  key={conn.id}
                  data-testid={`connection-session-tab-${conn.id}`}
                  active={isActive}
                  className={styles.connectionTab}
                  indicatorColor={isActive && conn.profile.color ? conn.profile.color : undefined}
                  onSelect={() => {
                    if (suppressNextSelectRef.current) {
                      return
                    }
                    switchTab(conn.id)
                  }}
                  onPointerDown={(event) => startPointerDrag(conn.id, event)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    openTabContextMenu(conn.id, e.clientX, e.clientY, e.currentTarget, conn.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) {
                      return
                    }
                    e.preventDefault()
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    openTabContextMenu(conn.id, rect.left, rect.bottom, e.currentTarget, conn.id)
                  }}
                  dragging={draggingTabId === conn.id}
                  dropIndicator={dropTarget?.tabId === conn.id ? dropTarget.indicator : undefined}
                  onAuxClick={(e) => {
                    if (e.button !== 1) return
                    e.preventDefault()
                    setPendingConnectionClose({
                      id: conn.id,
                      displayName,
                      hostPort: `${conn.profile.host}:${conn.profile.port}`,
                    })
                  }}
                  title={`${displayName} (${conn.profile.host}:${conn.profile.port})${
                    conn.profile.readOnly ? ' — Read-only' : ''
                  }`}
                  prefix={
                    <div className={styles.tabPrefix}>
                      {conn.profile.color && !isActive ? (
                        <span
                          className={styles.colorAccent}
                          style={{ backgroundColor: conn.profile.color }}
                          aria-hidden
                        />
                      ) : null}
                      <ConnectionStatusIndicator status={conn.status} size={8} />
                      {conn.profile.readOnly ? (
                        <LockIcon
                          className={styles.readOnlyIcon}
                          size={12}
                          weight="fill"
                          aria-label="Read-only connection"
                        />
                      ) : null}
                    </div>
                  }
                  suffix={
                    <button
                      type="button"
                      className={styles.closeButton}
                      aria-label={`Close ${displayName}`}
                      draggable={false}
                      data-tab-drag-ignore="true"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        void closeConnection(conn.id)
                      }}
                    >
                      <XIcon size={14} weight="regular" />
                    </button>
                  }
                >
                  <span className={styles.tabName}>{displayName}</span>
                </UnderlineTab>
              )
            })}
          </UnderlineTabBar>
        </div>
      )}
      <div className={styles.rightSection}>
        <button
          className={styles.iconButton}
          type="button"
          aria-label={resolvedTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          title={resolvedTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          onClick={handleThemeToggle}
          data-testid="theme-toggle"
        >
          {resolvedTheme === 'light' ? (
            <SunIcon size={20} weight="regular" />
          ) : (
            <MoonIcon size={20} weight="regular" />
          )}
        </button>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Session Snapshots"
          title="Session Snapshots"
          onClick={onOpenSnapshots}
          data-testid="snapshots-button"
        >
          <ClockCounterClockwiseIcon size={20} weight="regular" />
        </button>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
          data-testid="settings-button"
        >
          <GearSixIcon size={20} weight="regular" />
        </button>
      </div>
      {contextMenu && (
        <TabContextMenu
          visible
          x={contextMenu.x}
          y={contextMenu.y}
          portalRoot={contextMenu.portalRoot}
          items={[
            {
              key: 'move-start',
              label: 'Move to Start',
              icon: <CaretLineLeftIcon size={14} weight="regular" />,
              disabled: contextMenuTabIndex <= 0,
              onSelect: () => reorderActiveConnection(contextMenu.sessionId, 0),
            },
            {
              key: 'move-left',
              label: 'Move Left',
              icon: <CaretLeftIcon size={14} weight="regular" />,
              disabled: contextMenuTabIndex <= 0,
              onSelect: () => moveActiveConnection(contextMenu.sessionId, 'left'),
            },
            {
              key: 'move-right',
              label: 'Move Right',
              icon: <CaretRightIcon size={14} weight="regular" />,
              disabled: contextMenuTabIndex < 0 || contextMenuTabIndex >= sessionIds.length - 1,
              onSelect: () => moveActiveConnection(contextMenu.sessionId, 'right'),
            },
            {
              key: 'move-end',
              label: 'Move to End',
              icon: <CaretLineRightIcon size={14} weight="regular" />,
              disabled: contextMenuTabIndex < 0 || contextMenuTabIndex >= sessionIds.length - 1,
              onSelect: () => reorderActiveConnection(contextMenu.sessionId, sessionIds.length),
            },
          ]}
          onClose={() => {
            const invokerTabId = contextMenu.invokerTabId
            setContextMenu(null)
            restoreFocusAfterAction(invokerTabId)
          }}
        />
      )}
      <ConfirmDialog
        isOpen={pendingConnectionClose != null}
        title="Close connection?"
        message={
          pendingConnectionClose ? (
            <>
              Disconnect <strong>{pendingConnectionClose.displayName}</strong> (
              {pendingConnectionClose.hostPort})? Open workspace tabs for this connection will be
              closed.
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Close connection"
        isDestructive
        isLoading={isClosingConnection}
        onConfirm={() => {
          void handleConfirmCloseConnection()
        }}
        onCancel={() => {
          if (!isClosingConnection) {
            setPendingConnectionClose(null)
          }
        }}
      />
    </div>
  )
}
