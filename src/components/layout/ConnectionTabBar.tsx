import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
  MagnifyingGlassIcon,
} from '@phosphor-icons/react'
import { useThemeStore } from '../../stores/theme-store'
import { useCommandPaletteStore } from '../../stores/command-palette-store'
import { useShortcutStore } from '../../stores/shortcut-store'
import { shortcutLabelParts } from '../../lib/shortcut-labels'
import { Button } from '../common/Button'
import { IconButton } from '../common/IconButton'
import { normalizeActiveConnectionOrder, useConnectionStore } from '../../stores/connection-store'
import type { Theme } from '../../stores/theme-store'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import { UnderlineTabBar, UnderlineTab } from '../common/UnderlineTabs'
import { TabContextMenu } from '../shared/TabContextMenu'
import { usePointerTabDrag } from '../shared/use-pointer-tab-drag'
import { dispatchDismissAll } from '../../lib/context-menu-events'
import { getContextMenuPortalRoot } from '../../lib/context-menu-utils'
import styles from './ConnectionTabBar.module.css'

const CONNECTION_TAB_TEST_ID_PREFIX = 'connection-session-tab-'

export interface ConnectionTabBarProps {
  onOpenSettings?: () => void
  onOpenSnapshots?: () => void
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

  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const togglePalette = useCommandPaletteStore((state) => state.toggle)
  const paletteBinding = useShortcutStore((state) => state.shortcuts['command-palette'])
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
  const { draggingTabId, dropIndicatorFor, startPointerDrag, isSelectSuppressed } =
    usePointerTabDrag({
      tabIds: sessionIds,
      tabTestIdPrefix: CONNECTION_TAB_TEST_ID_PREFIX,
      onReorder: reorderActiveConnection,
    })
  const contextMenuTabIndex = contextMenu ? sessionIds.indexOf(contextMenu.sessionId) : -1
  const tabsByProfileId = new Map<string, typeof tabs>()
  for (const connection of tabs) {
    const pid = connection.profile.id
    const list = tabsByProfileId.get(pid) ?? []
    list.push(connection)
    tabsByProfileId.set(pid, list)
  }
  const tabDisplayName = (connection: (typeof tabs)[0]) => {
    const baseName =
      connection.profile.name.trim() !== '' ? connection.profile.name.trim() : 'Unnamed connection'
    const list = tabsByProfileId.get(connection.profile.id) ?? []
    if (list.length <= 1) {
      return baseName
    }
    const index = list.findIndex((otherConnection) => otherConnection.id === connection.id) + 1
    if (index === 1) {
      return baseName
    }
    return `${baseName} (${index})`
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
    const tabElement = document.querySelector<HTMLElement>(
      `[data-testid="${CONNECTION_TAB_TEST_ID_PREFIX}${sessionId}"]`
    )
    if (!tabElement) {
      return false
    }
    const labelButton = tabElement.querySelector<HTMLElement>('[role="button"],button')
    ;(labelButton ?? tabElement).focus()
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
    pointerX: number,
    pointerY: number,
    anchor: Element | null,
    invokerTabId: string
  ) => {
    dispatchDismissAll()
    setContextMenu({
      sessionId: sessionId,
      x: pointerX,
      y: pointerY,
      invokerTabId: invokerTabId,
      portalRoot: getContextMenuPortalRoot(anchor),
    })
  }

  const activeConnection = activeTabId ? activeConnections[activeTabId] : undefined
  const edgeColor = activeConnection?.profile.color || null
  const stripStyle = (
    edgeColor ? { '--connection-edge-color': edgeColor, '--connection-edge-width': '2px' } : {}
  ) as CSSProperties

  return (
    <div
      className={styles.tabBar}
      data-testid="connection-tab-bar"
      data-edge-color={edgeColor ? 'connection' : 'none'}
      style={stripStyle}
    >
      {tabs.length > 0 && (
        <UnderlineTabBar variant="document" className={styles.connectionTabRail}>
          {tabs.map((connection) => {
            const isActive = connection.id === activeTabId
            const displayName = tabDisplayName(connection)
            return (
              <UnderlineTab
                key={connection.id}
                variant="document"
                data-testid={`${CONNECTION_TAB_TEST_ID_PREFIX}${connection.id}`}
                active={isActive}
                className={styles.connectionTab}
                onSelect={() => {
                  if (isSelectSuppressed()) {
                    return
                  }
                  switchTab(connection.id)
                }}
                onPointerDown={(event) => startPointerDrag(connection.id, event)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  openTabContextMenu(
                    connection.id,
                    event.clientX,
                    event.clientY,
                    event.currentTarget,
                    connection.id
                  )
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
                    return
                  }
                  event.preventDefault()
                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
                  openTabContextMenu(
                    connection.id,
                    rect.left,
                    rect.bottom,
                    event.currentTarget,
                    connection.id
                  )
                }}
                dragging={draggingTabId === connection.id}
                dropIndicator={dropIndicatorFor(connection.id)}
                onAuxClick={(event) => {
                  if (event.button !== 1) return
                  event.preventDefault()
                  setPendingConnectionClose({
                    id: connection.id,
                    displayName: displayName,
                    hostPort: `${connection.profile.host}:${connection.profile.port}`,
                  })
                }}
                title={`${displayName} (${connection.profile.host}:${connection.profile.port})${
                  connection.profile.readOnly ? ' — Read-only' : ''
                }`}
                prefix={
                  <>
                    {connection.profile.color ? (
                      <span
                        className={styles.colorMarker}
                        style={{ backgroundColor: connection.profile.color }}
                        data-testid={`connection-color-marker-${connection.id}`}
                        aria-hidden
                      />
                    ) : null}
                    <ConnectionStatusIndicator status={connection.status} size={8} />
                    {connection.profile.readOnly ? (
                      <LockIcon
                        className={styles.readOnlyIcon}
                        size={12}
                        weight="fill"
                        aria-label="Read-only connection"
                      />
                    ) : null}
                  </>
                }
                suffix={
                  <IconButton
                    size="sm"
                    className={styles.closeButton}
                    aria-label={`Close ${displayName}`}
                    draggable={false}
                    data-tab-drag-ignore="true"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => {
                      void closeConnection(connection.id)
                    }}
                  >
                    <XIcon size={16} weight="regular" />
                  </IconButton>
                }
              >
                <span className={styles.tabName}>{displayName}</span>
              </UnderlineTab>
            )
          })}
        </UnderlineTabBar>
      )}
      <IconButton
        className={styles.newConnectionButton}
        aria-label="New connection"
        title="New connection"
        onClick={openDialog}
      >
        <PlusIcon size={16} weight="regular" />
      </IconButton>
      <div className={styles.dragSpace} />
      <Button
        variant="subtle"
        className={styles.searchBox}
        onClick={() => togglePalette()}
        data-testid="connection-strip-search"
      >
        <MagnifyingGlassIcon size={16} weight="regular" aria-hidden />
        <span className={styles.searchLabel}>Search tables, views, routines</span>
        {paletteBinding ? (
          <span className={styles.searchShortcut}>
            {shortcutLabelParts(paletteBinding).join(' ')}
          </span>
        ) : null}
      </Button>
      <div className={styles.tools}>
        <IconButton
          size="lg"
          aria-label={resolvedTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          title={resolvedTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          onClick={handleThemeToggle}
          data-testid="theme-toggle"
        >
          {resolvedTheme === 'light' ? (
            <SunIcon size={16} weight="regular" />
          ) : (
            <MoonIcon size={16} weight="regular" />
          )}
        </IconButton>
        <IconButton
          size="lg"
          aria-label="Session snapshots"
          title="Session snapshots"
          onClick={onOpenSnapshots}
          data-testid="snapshots-button"
        >
          <ClockCounterClockwiseIcon size={16} weight="regular" />
        </IconButton>
        <IconButton
          size="lg"
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
          data-testid="settings-button"
        >
          <GearSixIcon size={16} weight="regular" />
        </IconButton>
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
              label: 'Move to start',
              icon: <CaretLineLeftIcon size={14} weight="regular" />,
              disabled: contextMenuTabIndex <= 0,
              onSelect: () => reorderActiveConnection(contextMenu.sessionId, 0),
            },
            {
              key: 'move-left',
              label: 'Move left',
              icon: <CaretLeftIcon size={14} weight="regular" />,
              disabled: contextMenuTabIndex <= 0,
              onSelect: () => moveActiveConnection(contextMenu.sessionId, 'left'),
            },
            {
              key: 'move-right',
              label: 'Move right',
              icon: <CaretRightIcon size={14} weight="regular" />,
              disabled: contextMenuTabIndex < 0 || contextMenuTabIndex >= sessionIds.length - 1,
              onSelect: () => moveActiveConnection(contextMenu.sessionId, 'right'),
            },
            {
              key: 'move-end',
              label: 'Move to end',
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
