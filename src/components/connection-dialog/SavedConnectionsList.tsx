import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Plus, FolderPlus } from '@phosphor-icons/react'
import { useConnectionStore } from '../../stores/connection-store'
import {
  deleteConnection,
  createConnectionGroup,
  updateConnectionGroup,
  deleteConnectionGroup,
} from '../../lib/connection-commands'
import { useDismissOnOutsideClick } from './useDismissOnOutsideClick'
import type { SavedConnection, ConnectionGroup } from '../../types/connection'
import styles from './SavedConnectionsList.module.css'

// --- Simplification 6: pure helper to build grouped/sorted sections ---

interface ConnectionSection {
  groupId: string | null
  groupName: string | null
  sortOrder: number
  connections: SavedConnection[]
}

function buildConnectionSections(
  savedConnections: SavedConnection[],
  connectionGroups: ConnectionGroup[]
): ConnectionSection[] {
  const sortedGroups = [...connectionGroups].sort((a, b) => a.sortOrder - b.sortOrder)

  const connectionsByGroup = new Map<string | null, SavedConnection[]>()
  for (const group of sortedGroups) {
    connectionsByGroup.set(group.id, [])
  }
  connectionsByGroup.set(null, [])

  for (const conn of savedConnections) {
    const bucket = connectionsByGroup.get(conn.groupId)
    if (bucket) {
      bucket.push(conn)
    } else {
      // Group was deleted or doesn't exist — treat as ungrouped
      connectionsByGroup.get(null)!.push(conn)
    }
  }

  for (const [, conns] of connectionsByGroup) {
    conns.sort((a, b) => a.name.localeCompare(b.name))
  }

  const sections: ConnectionSection[] = sortedGroups.map((group) => ({
    groupId: group.id,
    groupName: group.name,
    sortOrder: group.sortOrder,
    connections: connectionsByGroup.get(group.id) ?? [],
  }))

  // Ungrouped section always last
  sections.push({
    groupId: null,
    groupName: null,
    sortOrder: Infinity,
    connections: connectionsByGroup.get(null) ?? [],
  })

  return sections
}

// --- Simplification 5: unified editing state for group rename / create ---

type EditingGroupState =
  | { mode: 'rename'; groupId: string; value: string }
  | { mode: 'create'; value: string }
  | null

interface GroupInlineInputProps {
  value: string
  onChange: (val: string) => void
  onCommit: () => void
  onCancel: () => void
  placeholder?: string
  ariaLabel: string
}

function GroupInlineInput({
  value,
  onChange,
  onCommit,
  onCancel,
  placeholder,
  ariaLabel,
}: GroupInlineInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  return (
    <input
      ref={inputRef}
      type="text"
      className={styles.renameInput}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onCommit()
        } else if (e.key === 'Escape') {
          onCancel()
        }
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  )
}

// --- Main component ---

interface SavedConnectionsListProps {
  onSelectConnection: (connection: SavedConnection) => void
  onNewConnection: () => void
  onDeleteConnection?: (id: string) => void
  selectedConnectionId: string | null
}

interface ContextMenuState {
  x: number
  y: number
  type: 'connection' | 'group'
  connectionId?: string
  groupId?: string
}

export function SavedConnectionsList({
  onSelectConnection,
  onNewConnection,
  onDeleteConnection,
  selectedConnectionId,
}: SavedConnectionsListProps) {
  const savedConnections = useConnectionStore((s) => s.savedConnections)
  const connectionGroups = useConnectionStore((s) => s.connectionGroups)
  const fetchSavedConnections = useConnectionStore((s) => s.fetchSavedConnections)

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editingGroup, setEditingGroup] = useState<EditingGroupState>(null)
  const [error, setError] = useState<string | null>(null)

  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Simplification 6: memoized sections
  const sections = useMemo(
    () => buildConnectionSections(savedConnections, connectionGroups),
    [savedConnections, connectionGroups]
  )

  // Simplification 7: outside-click / Escape dismissal for context menu
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  useDismissOnOutsideClick(contextMenuRef, !!contextMenu, closeContextMenu, {
    closeOnEscape: true,
  })

  // Auto-clear error after 5 seconds
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timer)
  }, [error])

  const handleConnectionContextMenu = useCallback((e: React.MouseEvent, connectionId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'connection', connectionId })
  }, [])

  const handleGroupContextMenu = useCallback((e: React.MouseEvent, groupId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'group', groupId })
  }, [])

  const handleDeleteConnection = useCallback(
    async (id: string) => {
      setContextMenu(null)
      const confirmed = window.confirm('Are you sure you want to delete this connection?')
      if (!confirmed) return

      try {
        await deleteConnection(id)
        await fetchSavedConnections()
        onDeleteConnection?.(id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete connection')
      }
    },
    [fetchSavedConnections, onDeleteConnection]
  )

  const handleRenameGroup = useCallback(
    (groupId: string) => {
      setContextMenu(null)
      const group = connectionGroups.find((g) => g.id === groupId)
      if (group) {
        setEditingGroup({ mode: 'rename', groupId, value: group.name })
      }
    },
    [connectionGroups]
  )

  const commitEditing = useCallback(async () => {
    if (!editingGroup) return

    const trimmedName = editingGroup.value.trim()

    if (editingGroup.mode === 'create') {
      // Clear state immediately (matches original optimistic UX)
      setEditingGroup(null)
      if (!trimmedName) return

      try {
        await createConnectionGroup(trimmedName)
        await fetchSavedConnections()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create group')
      }
    } else {
      // mode === 'rename'
      if (trimmedName) {
        try {
          await updateConnectionGroup(editingGroup.groupId, trimmedName)
          await fetchSavedConnections()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to rename group')
        }
      }
      setEditingGroup(null)
    }
  }, [editingGroup, fetchSavedConnections])

  const cancelEditing = useCallback(() => {
    setEditingGroup(null)
  }, [])

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      setContextMenu(null)
      const confirmed = window.confirm(
        'Are you sure you want to delete this group? Connections will be moved to ungrouped.'
      )
      if (!confirmed) return

      try {
        await deleteConnectionGroup(groupId)
        await fetchSavedConnections()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete group')
      }
    },
    [fetchSavedConnections]
  )

  const handleCreateGroup = useCallback(() => {
    setEditingGroup({ mode: 'create', value: '' })
  }, [])

  const renderConnectionItem = (conn: SavedConnection) => {
    const isSelected = conn.id === selectedConnectionId
    return (
      <div
        key={conn.id}
        className={`${styles.connectionItem} ${isSelected ? styles.connectionItemSelected : ''}`}
        onClick={() => onSelectConnection(conn)}
        onContextMenu={(e) => handleConnectionContextMenu(e, conn.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelectConnection(conn)
          }
        }}
      >
        <span
          className={styles.colorDot}
          style={{ backgroundColor: conn.color ?? 'var(--on-surface-variant)' }}
        />
        <span className={styles.connectionName}>{conn.name || conn.host}</span>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        {sections.map((section) => {
          // Skip empty ungrouped section
          if (section.groupId === null && section.connections.length === 0) return null

          const isGroupSection = section.groupId !== null
          const isRenaming =
            isGroupSection &&
            editingGroup?.mode === 'rename' &&
            editingGroup.groupId === section.groupId

          return (
            <div key={section.groupId ?? 'ungrouped'} className={styles.group}>
              <div
                className={styles.groupHeader}
                onContextMenu={
                  isGroupSection ? (e) => handleGroupContextMenu(e, section.groupId!) : undefined
                }
              >
                {isRenaming ? (
                  <GroupInlineInput
                    value={editingGroup!.value}
                    onChange={(val) =>
                      setEditingGroup((prev) => (prev ? { ...prev, value: val } : null))
                    }
                    onCommit={() => void commitEditing()}
                    onCancel={cancelEditing}
                    ariaLabel="Group name"
                  />
                ) : (
                  <span className={styles.groupName}>{section.groupName ?? 'Ungrouped'}</span>
                )}
              </div>
              {section.connections.map(renderConnectionItem)}
            </div>
          )
        })}

        {editingGroup?.mode === 'create' && (
          <div className={styles.group}>
            <div className={styles.groupHeader}>
              <GroupInlineInput
                value={editingGroup.value}
                onChange={(val) =>
                  setEditingGroup((prev) => (prev ? { ...prev, value: val } : null))
                }
                onCommit={() => void commitEditing()}
                onCancel={cancelEditing}
                placeholder="Group name"
                ariaLabel="New group name"
              />
            </div>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.actionButton}
          onClick={onNewConnection}
          title="New connection"
        >
          <Plus size={14} weight="bold" />
          New
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={handleCreateGroup}
          title="New group"
        >
          <FolderPlus size={14} weight="bold" />
          Grp
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <span className={styles.errorText}>{error}</span>
          <button
            type="button"
            className={styles.errorDismiss}
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
        >
          {contextMenu.type === 'connection' && contextMenu.connectionId && (
            <button
              type="button"
              className={styles.contextMenuItem}
              role="menuitem"
              onClick={() => void handleDeleteConnection(contextMenu.connectionId!)}
            >
              Delete
            </button>
          )}
          {contextMenu.type === 'group' && contextMenu.groupId && (
            <>
              <button
                type="button"
                className={styles.contextMenuItem}
                role="menuitem"
                onClick={() => handleRenameGroup(contextMenu.groupId!)}
              >
                Rename
              </button>
              <button
                type="button"
                className={styles.contextMenuItem}
                role="menuitem"
                onClick={() => void handleDeleteGroup(contextMenu.groupId!)}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
