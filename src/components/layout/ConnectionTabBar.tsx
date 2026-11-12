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
import type { ActiveConnection } from '../../types/connection'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import { UnderlineTabBar, UnderlineTab } from '../common/UnderlineTabs'
import { TabContextMenu } from '../shared/TabContextMenu'
import { usePointerTabDrag } from '../shared/use-pointer-tab-drag'
import { dispatchDismissAll } from '../../lib/context-menu-events'
import { getContextMenuPortalRoot } from '../../lib/context-menu-utils'
import { isMiddleMouseButton } from '../../lib/input-events'
import styles from './ConnectionTabBar.module.css'

const CONNECTION_TAB_TEST_ID_PREFIX = 'connection-session-tab-'

const UNNAMED_CONNECTION_LABEL = 'Unnamed connection'
const CONNECTION_EDGE_WIDTH = '2px'

interface PendingConnectionClose {
  id: string
  displayName: string
  hostPort: string
}

function hostPortOf(connection: ActiveConnection): string {
  return `${connection.profile.host}:${connection.profile.port}`
}

function connectionBaseName(connection: ActiveConnection): string {
  const trimmedName = connection.profile.name.trim()
  if (trimmedName === '') return UNNAMED_CONNECTION_LABEL
  return trimmedName
}

function connectionTabDisplayName(
  connection: ActiveConnection,
  tabsByProfileId: Map<string, ActiveConnection[]>
): string {
  const baseName = connectionBaseName(connection)
  const siblings = tabsByProfileId.get(connection.profile.id) ?? []
  const position = siblings.findIndex((sibling) => sibling.id === connection.id) + 1
  if (position <= 1) return baseName
  return `${baseName} (${position})`
}

function groupTabsByProfile(tabs: ActiveConnection[]): Map<string, ActiveConnection[]> {
  const tabsByProfileId = new Map<string, ActiveConnection[]>()
  for (const connection of tabs) {
    const profileId = connection.profile.id
    const profileTabs = tabsByProfileId.get(profileId) ?? []
    profileTabs.push(connection)
    tabsByProfileId.set(profileId, profileTabs)
  }
  return tabsByProfileId
}

function connectionEdgeColor(activeConnection: ActiveConnection | undefined): string | null {
  return activeConnection?.profile.color || null
}

function connectionTabTitle(displayName: string, connection: ActiveConnection): string {
  const readOnlySuffix = connection.profile.readOnly ? ' — Read-only' : ''
  return `${displayName} (${hostPortOf(connection)})${readOnlySuffix}`
}

function connectionEdgeStyle(edgeColor: string | null): CSSProperties {
  if (!edgeColor) return {}
  return {
    '--connection-edge-color': edgeColor,
    '--connection-edge-width': CONNECTION_EDGE_WIDTH,
  } as CSSProperties
}

function isContextMenuKey(event: React.KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
}

function ConnectionTabPrefix({ connection }: { connection: ActiveConnection }) {
  return (
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
  )
}

function ThemeToggleButton({
  resolvedTheme,
  onToggle,
}: {
  resolvedTheme: Theme
  onToggle: () => void
}) {
  const isLight = resolvedTheme === 'light'
  const label = isLight ? 'Switch to dark mode' : 'Switch to light mode'
  return (
    <IconButton
      size="lg"
      aria-label={label}
      title={label}
      onClick={onToggle}
      data-testid="theme-toggle"
    >
      {isLight ? <SunIcon size={16} weight="regular" /> : <MoonIcon size={16} weight="regular" />}
    </IconButton>
  )
}

function CloseConnectionMessage({ pending }: { pending: PendingConnectionClose | null }) {
  if (!pending) return null
  return (
    <>
      Disconnect <strong>{pending.displayName}</strong> ({pending.hostPort})? Open workspace tabs
      for this connection will be closed.
    </>
  )
}

interface MoveMenuInputs {
  sessionId: string
  tabIndex: number
  tabCount: number
  reorder: (sessionId: string, index: number) => void
  move: (sessionId: string, direction: 'left' | 'right') => void
}

function connectionMoveMenuItems(inputs: MoveMenuInputs) {
  const isFirstOrMissing = inputs.tabIndex <= 0
  const isLastOrMissing = inputs.tabIndex < 0 || inputs.tabIndex >= inputs.tabCount - 1
  return [
    {
      key: 'move-start',
      label: 'Move to start',
      icon: <CaretLineLeftIcon size={14} weight="regular" />,
      disabled: isFirstOrMissing,
      onSelect: () => inputs.reorder(inputs.sessionId, 0),
    },
    {
      key: 'move-left',
      label: 'Move left',
      icon: <CaretLeftIcon size={14} weight="regular" />,
      disabled: isFirstOrMissing,
      onSelect: () => inputs.move(inputs.sessionId, 'left'),
    },
    {
      key: 'move-right',
      label: 'Move right',
      icon: <CaretRightIcon size={14} weight="regular" />,
      disabled: isLastOrMissing,
      onSelect: () => inputs.move(inputs.sessionId, 'right'),
    },
    {
      key: 'move-end',
      label: 'Move to end',
      icon: <CaretLineRightIcon size={14} weight="regular" />,
      disabled: isLastOrMissing,
      onSelect: () => inputs.reorder(inputs.sessionId, inputs.tabCount),
    },
  ]
}

export interface ConnectionTabBarProps {
  onOpenSettings?: () => void
  onOpenSnapshots?: () => void
}

export function ConnectionTabBar({ onOpenSettings, onOpenSnapshots }: ConnectionTabBarProps) {
  const [pendingConnectionClose, setPendingConnectionClose] =
    useState<PendingConnectionClose | null>(null)
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
  const tabsByProfileId = groupTabsByProfile(tabs)

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
    const hasRestoredInvokerFocus = invokerTabId !== null && focusConnectionTab(invokerTabId)
    if (hasRestoredInvokerFocus) {
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
  const edgeColor = connectionEdgeColor(activeConnection)
  const stripStyle = connectionEdgeStyle(edgeColor)

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
            const displayName = connectionTabDisplayName(connection, tabsByProfileId)
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
                  if (!isContextMenuKey(event)) {
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
                  if (!isMiddleMouseButton(event)) return
                  event.preventDefault()
                  setPendingConnectionClose({
                    id: connection.id,
                    displayName: displayName,
                    hostPort: hostPortOf(connection),
                  })
                }}
                title={connectionTabTitle(displayName, connection)}
                prefix={<ConnectionTabPrefix connection={connection} />}
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
        <ThemeToggleButton resolvedTheme={resolvedTheme} onToggle={handleThemeToggle} />
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
          items={connectionMoveMenuItems({
            sessionId: contextMenu.sessionId,
            tabIndex: contextMenuTabIndex,
            tabCount: sessionIds.length,
            reorder: reorderActiveConnection,
            move: moveActiveConnection,
          })}
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
        message={<CloseConnectionMessage pending={pendingConnectionClose} />}
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
