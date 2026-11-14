import { useEffect, useMemo, useRef, useState } from 'react'
import { PlusIcon } from '@phosphor-icons/react'
import { useThemeStore } from '../../stores/theme-store'
import { IconButton } from '../common/IconButton'
import { normalizeActiveConnectionOrder, useConnectionStore } from '../../stores/connection-store'
import type { Theme } from '../../stores/theme-store'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import { TabContextMenu } from '../shared/TabContextMenu'
import { usePointerTabDrag } from '../shared/use-pointer-tab-drag'
import { dispatchDismissAll } from '../../lib/context-menu-events'
import { getContextMenuPortalRoot } from '../../lib/context-menu-utils'
import type { ContextMenuOpenPoint } from '../../lib/context-menu-utils'
import type { ActiveConnection } from '../../types/connection'
import styles from './ConnectionTabBar.module.css'
import {
  CONNECTION_TAB_TEST_ID_PREFIX,
  connectionEdgeColor,
  connectionEdgeStyle,
  connectionMoveMenuItems,
  connectionTabDisplayName,
  focusConnectionTab,
  groupTabsByProfile,
  type PendingConnectionClose,
} from './connection-tab-bar/connection-tab-model'
import { ConnectionTab, type ConnectionTabActions } from './connection-tab-bar/ConnectionTab'
import {
  CloseConnectionMessage,
  ConnectionStripTools,
} from './connection-tab-bar/ConnectionTabParts'

export interface ConnectionTabBarProps {
  onOpenSettings?: () => void
  onOpenSnapshots?: () => void
}

interface TabContextMenuState {
  sessionId: string
  x: number
  y: number
  invokerTabId: string
  portalRoot: HTMLElement
}

function useOrderedConnectionTabs(): ActiveConnection[] {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeConnectionOrder = useConnectionStore((state) => state.activeConnectionOrder)
  const orderedSessionIds = useMemo(
    () => normalizeActiveConnectionOrder(activeConnectionOrder, activeConnections),
    [activeConnectionOrder, activeConnections]
  )
  return orderedSessionIds
    .map((sessionId) => activeConnections[sessionId])
    .filter((connection): connection is NonNullable<typeof connection> => Boolean(connection))
}

function useConnectionCloseFlow() {
  const closeConnection = useConnectionStore((state) => state.closeConnection)
  const [pendingConnectionClose, setPendingConnectionClose] =
    useState<PendingConnectionClose | null>(null)
  const [isClosingConnection, setIsClosingConnection] = useState(false)

  const handleConfirmCloseConnection = async () => {
    if (!pendingConnectionClose) {
      return
    }
    setIsClosingConnection(true)
    try {
      await closeConnection(pendingConnectionClose.id)
    } finally {
      setIsClosingConnection(false)
      setPendingConnectionClose(null)
    }
  }

  return {
    pendingConnectionClose,
    setPendingConnectionClose,
    isClosingConnection,
    handleConfirmCloseConnection,
  }
}

function useActiveTabIdRef(activeTabId: string | null) {
  const activeTabIdRef = useRef<string | null>(activeTabId)
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])
  return activeTabIdRef
}

function useTabContextMenu(activeTabId: string | null) {
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null)
  const activeTabIdRef = useActiveTabIdRef(activeTabId)

  const openTabContextMenu = (sessionId: string, { x, y, anchor }: ContextMenuOpenPoint) => {
    dispatchDismissAll()
    setContextMenu({
      sessionId: sessionId,
      x: x,
      y: y,
      invokerTabId: sessionId,
      portalRoot: getContextMenuPortalRoot(anchor),
    })
  }

  const closeTabContextMenu = (invokerTabId: string) => {
    setContextMenu(null)
    const hasRestoredInvokerFocus = focusConnectionTab(invokerTabId)
    if (hasRestoredInvokerFocus) return
    if (activeTabIdRef.current) focusConnectionTab(activeTabIdRef.current)
  }

  return { contextMenu, openTabContextMenu, closeTabContextMenu }
}

interface ConnectionMoveMenuProps {
  menu: ReturnType<typeof useTabContextMenu>
  sessionIds: string[]
}

function ConnectionMoveMenu({ menu, sessionIds }: ConnectionMoveMenuProps) {
  const reorderActiveConnection = useConnectionStore((state) => state.reorderActiveConnection)
  const moveActiveConnection = useConnectionStore((state) => state.moveActiveConnection)
  const { contextMenu } = menu
  if (!contextMenu) return null
  return (
    <TabContextMenu
      visible
      x={contextMenu.x}
      y={contextMenu.y}
      portalRoot={contextMenu.portalRoot}
      items={connectionMoveMenuItems({
        sessionId: contextMenu.sessionId,
        tabIndex: sessionIds.indexOf(contextMenu.sessionId),
        tabCount: sessionIds.length,
        reorder: reorderActiveConnection,
        move: moveActiveConnection,
      })}
      onClose={() => menu.closeTabContextMenu(contextMenu.invokerTabId)}
    />
  )
}

function CloseConnectionDialog({ flow }: { flow: ReturnType<typeof useConnectionCloseFlow> }) {
  const { pendingConnectionClose, isClosingConnection } = flow
  return (
    <ConfirmDialog
      isOpen={pendingConnectionClose != null}
      title="Close connection?"
      message={<CloseConnectionMessage pending={pendingConnectionClose} />}
      confirmLabel="Close connection"
      isDestructive
      isLoading={isClosingConnection}
      onConfirm={() => {
        void flow.handleConfirmCloseConnection()
      }}
      onCancel={() => {
        if (!isClosingConnection) {
          flow.setPendingConnectionClose(null)
        }
      }}
    />
  )
}

interface ConnectionTabRailProps {
  tabs: ActiveConnection[]
  activeTabId: string | null
  actions: ConnectionTabActions
}

function ConnectionTabRail({ tabs, activeTabId, actions }: ConnectionTabRailProps) {
  const tabsByProfileId = groupTabsByProfile(tabs)
  if (tabs.length === 0) return null
  return (
    <UnderlineTabBar variant="document" className={styles.connectionTabRail}>
      {tabs.map((connection) => (
        <ConnectionTab
          key={connection.id}
          connection={connection}
          displayName={connectionTabDisplayName(connection, tabsByProfileId)}
          isActive={connection.id === activeTabId}
          actions={actions}
        />
      ))}
    </UnderlineTabBar>
  )
}

function useThemeToggle() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const handleThemeToggle = () => {
    const nextTheme: Theme = resolvedTheme === 'light' ? 'dark' : 'light'
    void setTheme(nextTheme)
  }
  return { resolvedTheme, handleThemeToggle }
}

export function ConnectionTabBar({ onOpenSettings, onOpenSnapshots }: ConnectionTabBarProps) {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeTabId = useConnectionStore((state) => state.activeTabId)
  const switchTab = useConnectionStore((state) => state.switchTab)
  const closeConnection = useConnectionStore((state) => state.closeConnection)
  const openDialog = useConnectionStore((state) => state.openDialog)
  const reorderActiveConnection = useConnectionStore((state) => state.reorderActiveConnection)
  const theme = useThemeToggle()
  const closeFlow = useConnectionCloseFlow()
  const menu = useTabContextMenu(activeTabId)
  const tabs = useOrderedConnectionTabs()
  const sessionIds = tabs.map((connection) => connection.id)
  const drag = usePointerTabDrag({
    tabIds: sessionIds,
    tabTestIdPrefix: CONNECTION_TAB_TEST_ID_PREFIX,
    onReorder: reorderActiveConnection,
  })
  const edgeColor = connectionEdgeColor(activeTabId ? activeConnections[activeTabId] : undefined)

  return (
    <div
      className={styles.tabBar}
      data-testid="connection-tab-bar"
      data-edge-color={edgeColor ? 'connection' : 'none'}
      style={connectionEdgeStyle(edgeColor)}
    >
      <ConnectionTabRail
        tabs={tabs}
        activeTabId={activeTabId}
        actions={{
          drag: drag,
          onSwitch: switchTab,
          onOpenContextMenu: menu.openTabContextMenu,
          onRequestClose: closeFlow.setPendingConnectionClose,
          onClose: closeConnection,
        }}
      />
      <IconButton
        className={styles.newConnectionButton}
        aria-label="New connection"
        title="New connection"
        onClick={openDialog}
      >
        <PlusIcon size={16} weight="regular" />
      </IconButton>
      <div className={styles.dragSpace} />
      <ConnectionStripTools
        resolvedTheme={theme.resolvedTheme}
        onToggleTheme={theme.handleThemeToggle}
        onOpenSettings={onOpenSettings}
        onOpenSnapshots={onOpenSnapshots}
      />
      <ConnectionMoveMenu menu={menu} sessionIds={sessionIds} />
      <CloseConnectionDialog flow={closeFlow} />
    </div>
  )
}
