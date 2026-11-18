import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { Sidebar } from './Sidebar'
import { WorkspaceArea } from './WorkspaceArea'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'

export function MainPanels() {
  const sidebarPanelRef = usePanelRef()
  const handleSeparatorDoubleClick = () => {
    sidebarPanelRef.current?.resize('20%')
  }
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-light-surface-container dark:bg-dark-surface-container">
      <Group orientation="horizontal" className="h-full">
        <Panel
          panelRef={sidebarPanelRef}
          id="sidebar"
          defaultSize="20%"
          minSize="12%"
          maxSize="37%"
          className="overflow-hidden"
        >
          <Sidebar />
        </Panel>
        <Separator
          className={joinClassNames([
            'relative z-0 w-resize-handle shrink-0 cursor-col-resize bg-transparent transition-bg duration-150 hover:bg-light-primary resize-dragging:bg-light-primary dark:hover:bg-dark-primary dark:resize-dragging:bg-dark-primary',
            FOCUS_RING,
          ])}
          onDoubleClick={handleSeparatorDoubleClick}
        />
        <Panel id="workspace" className="min-h-0" style={{ overflow: 'visible' }}>
          <WorkspaceArea />
        </Panel>
      </Group>
    </div>
  )
}
