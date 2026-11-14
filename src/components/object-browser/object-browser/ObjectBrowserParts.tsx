import { lazy, Suspense, type RefObject } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import type { useObjectBrowserActions } from '../../../hooks/useObjectBrowserActions'
import { TextInput } from '../../common/TextInput'
import { IconButton } from '../../common/IconButton'
import { ObjectBrowserContextMenu } from '../ObjectBrowserContextMenu'
import type {
  ActiveConnectionState,
  CopyToHostDialogState,
  SqlDumpDialogState,
} from './object-browser-model'
import type { ObjectBrowserMenus } from './use-object-browser-menus'
import styles from '../ObjectBrowser.module.css'

const SqlDumpDialog = lazy(() => import('../../dialogs/SqlDumpDialog'))
const CopyToHostDialog = lazy(() => import('../../dialogs/CopyToHostDialog'))

interface ObjectTreeBodyProps {
  isConnected: boolean
  topLevelIds: string[]
  children: React.ReactNode
}

export function ObjectTreeBody({ isConnected, topLevelIds, children }: ObjectTreeBodyProps) {
  if (!isConnected) return <div className={styles.emptyState}>Not connected</div>
  if (topLevelIds.length === 0) return <div className={styles.emptyState}>No databases loaded</div>
  return (
    <div role="tree" aria-label="Database objects">
      {children}
    </div>
  )
}

interface CopyToHostDialogHostProps {
  dialog: CopyToHostDialogState
  connectionId: string
  activeConnection: ActiveConnectionState | null
  onClose: () => void
}

export function CopyToHostDialogHost({
  dialog,
  connectionId,
  activeConnection,
  onClose,
}: CopyToHostDialogHostProps) {
  const profile = activeConnection?.profile
  if (!dialog.open) return null
  if (!dialog.database) return null
  if (!profile) return null
  return (
    <Suspense fallback={null}>
      <CopyToHostDialog
        isOpen
        onClose={onClose}
        sourceConnectionId={connectionId}
        sourceConnectionLabel={profile.name}
        sourceDatabase={dialog.database}
        preSelectedObject={dialog.objectSelection}
      />
    </Suspense>
  )
}

interface ObjectFilterBarProps {
  filterInputRef: RefObject<HTMLInputElement | null>
  filterText: string
  onFilterChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onClearFilter: () => void
}

export function ObjectFilterBar({
  filterInputRef,
  filterText,
  onFilterChange,
  onClearFilter,
}: ObjectFilterBarProps) {
  return (
    <div className={styles.searchWrapper}>
      <span className={styles.searchIcon}>
        <MagnifyingGlass size={16} weight="regular" />
      </span>
      <TextInput
        ref={filterInputRef}
        type="text"
        className={styles.searchInput}
        placeholder="Filter objects"
        value={filterText}
        onChange={onFilterChange}
        data-testid="filter-input"
        aria-label="Filter objects"
      />
      {filterText && (
        <IconButton
          size="sm"
          className={styles.clearButton}
          onClick={onClearFilter}
          tabIndex={-1}
          aria-label="Clear filter"
          data-testid="filter-clear-button"
        >
          <X size={16} weight="regular" />
        </IconButton>
      )}
    </div>
  )
}

interface ObjectBrowserMenuProps {
  connectionId: string
  isReadOnly: boolean
  menus: ObjectBrowserMenus
  actions: ReturnType<typeof useObjectBrowserActions>
}

export function ObjectBrowserMenu({
  connectionId,
  isReadOnly,
  menus,
  actions,
}: ObjectBrowserMenuProps) {
  const { contextMenu } = menus
  return (
    <ObjectBrowserContextMenu
      visible={contextMenu.visible}
      x={contextMenu.x}
      y={contextMenu.y}
      nodeId={contextMenu.nodeId}
      connectionId={connectionId}
      isReadOnly={isReadOnly}
      onClose={menus.handleContextMenuClose}
      onCreateDatabase={actions.onCreateDatabase}
      onAlterDatabase={actions.onAlterDatabase}
      onRenameDatabase={actions.onRenameDatabase}
      onDropDatabase={actions.onDropDatabase}
      onDropTable={actions.onDropTable}
      onTruncateTable={actions.onTruncateTable}
      onRenameTable={actions.onRenameTable}
      onDesignTable={menus.handleDesignTable}
      onCreateTable={menus.handleCreateTable}
      onAlterObject={actions.onAlterObject}
      onDropObject={actions.onDropObject}
      onCreateObject={actions.onCreateObject}
      onExecuteRoutine={actions.onExecuteRoutine}
      onExportDump={menus.handleExportDump}
      onExportDdl={menus.handleExportDdl}
      onCopyToHost={menus.handleCopyToHost}
    />
  )
}

interface SqlDumpDialogHostProps {
  dialog: SqlDumpDialogState
  connectionId: string
  onClose: () => void
}

export function SqlDumpDialogHost({ dialog, connectionId, onClose }: SqlDumpDialogHostProps) {
  if (!dialog.open) return null
  return (
    <Suspense fallback={null}>
      <SqlDumpDialog
        connectionId={connectionId}
        initialDatabase={dialog.database}
        initialTable={dialog.table}
        schemaOnly={dialog.schemaOnly}
        onClose={onClose}
      />
    </Suspense>
  )
}
