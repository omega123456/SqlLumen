import { XIcon } from '@phosphor-icons/react'
import { IconButton } from '../../common/IconButton'
import { UnderlineTab } from '../../common/UnderlineTabs'
import type { ContextMenuOpenPoint } from '../../../lib/context-menu-utils'
import { isContextMenuKey, isMiddleMouseButton } from '../../../lib/input-events'
import type { ActiveConnection } from '../../../types/connection'
import type { PointerTabDrag } from '../../shared/use-pointer-tab-drag'
import {
  CONNECTION_TAB_TEST_ID_PREFIX,
  connectionTabTitle,
  hostPortOf,
  type PendingConnectionClose,
} from './connection-tab-model'
import { ConnectionTabPrefix } from './ConnectionTabParts'

export interface ConnectionTabActions {
  drag: PointerTabDrag
  onSwitch: (sessionId: string) => void
  onOpenContextMenu: (sessionId: string, point: ContextMenuOpenPoint) => void
  onRequestClose: (pending: PendingConnectionClose) => void
  onClose: (sessionId: string) => unknown
}

interface ConnectionTabProps {
  connection: ActiveConnection
  displayName: string
  isActive: boolean
  actions: ConnectionTabActions
}

function CloseTabButton({ displayName, onClose }: { displayName: string; onClose: () => void }) {
  return (
    <IconButton
      size="sm"
      className="group-not-data-active/tab:not-group-hover/tab:invisible"
      aria-label={`Close ${displayName}`}
      draggable={false}
      data-tab-drag-ignore="true"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={onClose}
    >
      <XIcon size={16} weight="regular" />
    </IconButton>
  )
}

export function ConnectionTab({ connection, displayName, isActive, actions }: ConnectionTabProps) {
  const { drag } = actions
  const sessionId = connection.id
  return (
    <UnderlineTab
      variant="connection"
      data-testid={`${CONNECTION_TAB_TEST_ID_PREFIX}${sessionId}`}
      active={isActive}
      onSelect={() => {
        if (drag.isSelectSuppressed()) {
          return
        }
        actions.onSwitch(sessionId)
      }}
      onPointerDown={(event) => drag.startPointerDrag(sessionId, event)}
      onContextMenu={(event) => {
        event.preventDefault()
        actions.onOpenContextMenu(sessionId, {
          x: event.clientX,
          y: event.clientY,
          anchor: event.currentTarget,
        })
      }}
      onKeyDown={(event) => {
        if (!isContextMenuKey(event)) {
          return
        }
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        actions.onOpenContextMenu(sessionId, {
          x: rect.left,
          y: rect.bottom,
          anchor: event.currentTarget,
        })
      }}
      dragging={drag.draggingTabId === sessionId}
      dropIndicator={drag.dropIndicatorFor(sessionId)}
      onAuxClick={(event) => {
        if (!isMiddleMouseButton(event)) return
        event.preventDefault()
        actions.onRequestClose({
          id: sessionId,
          displayName: displayName,
          hostPort: hostPortOf(connection),
        })
      }}
      title={connectionTabTitle(displayName, connection)}
      prefix={<ConnectionTabPrefix connection={connection} />}
      suffix={
        <CloseTabButton displayName={displayName} onClose={() => void actions.onClose(sessionId)} />
      }
    >
      <span className="max-w-40 flex-1 truncate">{displayName}</span>
    </UnderlineTab>
  )
}
