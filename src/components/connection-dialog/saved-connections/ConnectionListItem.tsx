import { Copy } from '@phosphor-icons/react'
import { IconButton } from '../../common/IconButton'
import { isActivationKey } from '../../../lib/input-events'
import type { SavedConnection } from '../../../types/connection'
import styles from '../SavedConnectionsList.module.css'

const ITEM_ICON_SIZE = 16

export interface ConnectionItemHandlers {
  onSelect: (connection: SavedConnection) => void
  onContextMenu: (event: React.MouseEvent, connection: SavedConnection) => void
  onDuplicate: (connection: SavedConnection) => void
}

interface ConnectionListItemProps {
  connection: SavedConnection
  isSelected: boolean
  handlers: ConnectionItemHandlers
}

export function ConnectionListItem({ connection, isSelected, handlers }: ConnectionListItemProps) {
  const hasName = Boolean(connection.name.trim())
  const titleText = hasName ? connection.name : connection.host
  return (
    <div
      className={`${styles.connectionItem} ${isSelected ? styles.connectionItemSelected : ''}`}
      onClick={() => handlers.onSelect(connection)}
      onContextMenu={(event) => handlers.onContextMenu(event, connection)}
      role="button"
      data-testid="connection-list-item"
      tabIndex={0}
      onKeyDown={(event) => {
        if (isActivationKey(event.key)) {
          event.preventDefault()
          handlers.onSelect(connection)
        }
      }}
    >
      <span className={styles.connectionTitle}>
        <span
          className={styles.colorDot}
          style={{ backgroundColor: connection.color ?? 'var(--outline)' }}
        />
        <span className={styles.connectionName}>{titleText}</span>
      </span>
      {hasName && <span className={styles.connectionHost}>{connection.host}</span>}
      <div className={styles.itemActions}>
        <IconButton
          size="sm"
          title="Duplicate connection"
          aria-label={`Duplicate ${titleText}`}
          onClick={(event) => {
            event.stopPropagation()
            handlers.onDuplicate(connection)
          }}
        >
          <Copy size={ITEM_ICON_SIZE} weight="regular" />
        </IconButton>
      </div>
    </div>
  )
}
