import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { ConnectionTabBar } from './ConnectionTabBar'
import { Sidebar } from './Sidebar'
import { WorkspaceArea } from './WorkspaceArea'
import { StatusBar } from './StatusBar'
import { ConnectionDialog } from '../connection-dialog/ConnectionDialog'
import { ToastViewport } from '../common/ToastViewport'
import styles from './AppLayout.module.css'

export function AppLayout() {
  const sidebarPanelRef = usePanelRef()

  const handleSeparatorDoubleClick = () => {
    sidebarPanelRef.current?.resize('20%')
  }

  return (
    <div className={styles.appLayout} data-testid="app-layout">
      <ConnectionTabBar />
      <div className={styles.mainContent}>
        <Group orientation="horizontal" className={styles.panelGroup}>
          <Panel
            panelRef={sidebarPanelRef}
            id="sidebar"
            defaultSize="20%"
            minSize="12%"
            maxSize="37%"
            className={styles.sidebarPanel}
          >
            <Sidebar />
          </Panel>
          <Separator className={styles.resizeHandle} onDoubleClick={handleSeparatorDoubleClick} />
          <Panel id="workspace" className={styles.workspacePanel}>
            <WorkspaceArea />
          </Panel>
        </Group>
      </div>
      <StatusBar />
      <ConnectionDialog />
      <ToastViewport />
    </div>
  )
}
