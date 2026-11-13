import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import Fuse from 'fuse.js'
import {
  Plus,
  FolderPlus,
  ShieldCheck,
  PencilSimple,
  Trash,
  Copy,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react'
import { TextInput } from '../common/TextInput'
import { IconButton } from '../common/IconButton'
import { InfoBar } from '../common/InfoBar'
import { useConnectionStore } from '../../stores/connection-store'
import {
  createConnectionGroup,
  updateConnectionGroup,
  deleteConnectionGroup,
} from '../../lib/connection-commands'
import { useDismissOnOutsideClick } from './useDismissOnOutsideClick'
import {
  getContextMenuPositionMode,
  getContextMenuPortalRoot,
  isEditableFieldElement,
  positionContextMenuInPortal,
} from '../../lib/context-menu-utils'
import type { SavedConnection, ConnectionGroup } from '../../types/connection'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import { Button } from '../common/Button'
import styles from './SavedConnectionsList.module.css'
import { isActivationKey } from '../../lib/input-events'

const ERROR_AUTO_CLEAR_MS = 5000

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
  const sortedGroups = [...connectionGroups].sort((left, right) => left.sortOrder - right.sortOrder)

  const connectionsByGroup = new Map<string | null, SavedConnection[]>()
  for (const group of sortedGroups) {
    connectionsByGroup.set(group.id, [])
  }
  const ungroupedConnections: SavedConnection[] = []
  connectionsByGroup.set(null, ungroupedConnections)

  for (const connection of savedConnections) {
    const bucket = connectionsByGroup.get(connection.groupId) ?? ungroupedConnections
    bucket.push(connection)
  }

  for (const [, connections] of connectionsByGroup) {
    connections.sort((left, right) => left.name.localeCompare(right.name))
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

// --- Fuzzy filter for the quick-search bar (case-insensitive, name + host) ---

function filterConnectionsByQuery(
  savedConnections: SavedConnection[],
  query: string
): SavedConnection[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return savedConnections
  }

  const fuse = new Fuse(savedConnections, {
    keys: ['name', 'host'],
    // threshold 0 = exact (case-insensitive) substring match anywhere in the
    // name or host. No typo tolerance, so unrelated entries never sneak in.
    threshold: 0,
    ignoreLocation: true,
    isCaseSensitive: false,
  })

  return fuse.search(trimmed).map((result) => result.item)
}

// --- Simplification 5: unified editing state for group rename / create ---

type EditingGroupState =
  { mode: 'rename'; groupId: string; value: string } | { mode: 'create'; value: string } | null

const UNGROUPED_SECTION_KEY = 'ungrouped'
const UNGROUPED_SECTION_TITLE = 'Ungrouped'

interface GroupMutation {
  run: () => Promise<unknown>
  successTitle: string
  failureTitle: string
  groupName: string
}

function sectionRenameValue(
  section: ConnectionSection,
  editingGroup: EditingGroupState
): string | null {
  if (section.groupId === null) return null
  if (editingGroup?.mode !== 'rename') return null
  if (editingGroup.groupId !== section.groupId) return null
  return editingGroup.value
}

interface SectionVisibilityInputs {
  section: ConnectionSection
  isFiltering: boolean
  isRenaming: boolean
}

function shouldHideSection(inputs: SectionVisibilityInputs): boolean {
  const hasConnections = inputs.section.connections.length > 0
  if (hasConnections) return false
  if (inputs.isRenaming) return false
  const isGroupSection = inputs.section.groupId !== null
  return !isGroupSection || inputs.isFiltering
}

function sectionKey(section: ConnectionSection): string {
  return section.groupId ?? UNGROUPED_SECTION_KEY
}

function sectionTitle(section: ConnectionSection): string {
  return section.groupName ?? UNGROUPED_SECTION_TITLE
}

interface GroupInlineInputProps {
  value: string
  onChange: (value: string) => void
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
    <TextInput
      ref={inputRef}
      variant="bare"
      type="text"
      className={`ui-field-chrome ${styles.renameInput}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        const keyActions: Partial<Record<string, () => void>> = {
          Enter: onCommit,
          Escape: onCancel,
        }
        keyActions[event.key]?.()
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
  onDuplicateConnection: (connection: SavedConnection) => void
  selectedConnectionId: string | null
}

interface ContextMenuPosition {
  x: number
  y: number
  portalRoot: HTMLElement
}

type ContextMenuState =
  | (ContextMenuPosition & { type: 'group'; groupId: string })
  | (ContextMenuPosition & { type: 'connection'; connection: SavedConnection })

export function SavedConnectionsList({
  onSelectConnection,
  onNewConnection,
  onDuplicateConnection,
  selectedConnectionId,
}: SavedConnectionsListProps) {
  const savedConnections = useConnectionStore((state) => state.savedConnections)
  const connectionGroups = useConnectionStore((state) => state.connectionGroups)
  const fetchSavedConnections = useConnectionStore((state) => state.fetchSavedConnections)

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editingGroup, setEditingGroup] = useState<EditingGroupState>(null)
  const [error, setError] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')

  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Fuzzy quick-filter, then build the grouped/sorted sections from the result
  const filteredConnections = useMemo(
    () => filterConnectionsByQuery(savedConnections, filterText),
    [savedConnections, filterText]
  )

  // Simplification 6: memoized sections
  const sections = useMemo(
    () => buildConnectionSections(filteredConnections, connectionGroups),
    [filteredConnections, connectionGroups]
  )

  const hasMatches = filteredConnections.length > 0
  const isFiltering = filterText.trim().length > 0

  // Simplification 7: outside-click / Escape dismissal for context menu
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  useDismissOnOutsideClick({
    ref: contextMenuRef,
    active: !!contextMenu,
    onDismiss: closeContextMenu,
    options: {
      closeOnEscape: true,
    },
  })

  useLayoutEffect(() => {
    const element = contextMenuRef.current
    if (!contextMenu) return
    if (!element) return
    const rect = element.getBoundingClientRect()
    const position = positionContextMenuInPortal({
      portalRoot: contextMenu.portalRoot,
      clientX: contextMenu.x,
      clientY: contextMenu.y,
      menuWidth: rect.width,
      menuHeight: rect.height,
    })
    element.style.left = `${position.x}px`
    element.style.top = `${position.y}px`
  }, [contextMenu])

  // Auto-clear error after 5 seconds
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), ERROR_AUTO_CLEAR_MS)
    return () => clearTimeout(timer)
  }, [error])

  const handleGroupContextMenu = useCallback((event: React.MouseEvent, groupId: string) => {
    event.preventDefault()
    const anchor = event.currentTarget
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      portalRoot: getContextMenuPortalRoot(anchor),
      type: 'group',
      groupId: groupId,
    })
  }, [])

  const groupHeaderContextMenu = (section: ConnectionSection) => {
    const groupId = section.groupId
    if (groupId === null) return undefined
    return (event: React.MouseEvent) => {
      if (isEditableFieldElement(event.target)) {
        return
      }
      handleGroupContextMenu(event, groupId)
    }
  }

  const handleConnectionContextMenu = useCallback(
    (event: React.MouseEvent, connection: SavedConnection) => {
      event.preventDefault()
      const anchor = event.currentTarget
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        portalRoot: getContextMenuPortalRoot(anchor),
        type: 'connection',
        connection: connection,
      })
    },
    []
  )

  const handleDuplicateConnection = useCallback(
    (connection: SavedConnection) => {
      setContextMenu(null)
      onDuplicateConnection(connection)
    },
    [onDuplicateConnection]
  )

  const handleRenameGroup = useCallback(
    (groupId: string) => {
      setContextMenu(null)
      const group = connectionGroups.find((connectionGroup) => connectionGroup.id === groupId)
      if (group) {
        setEditingGroup({ mode: 'rename', groupId: groupId, value: group.name })
      }
    },
    [connectionGroups]
  )

  const runGroupMutation = useCallback(
    async (mutation: GroupMutation) => {
      try {
        await mutation.run()
        await fetchSavedConnections()
        showSuccessToast(mutation.successTitle, mutation.groupName)
      } catch (error) {
        const message = error instanceof Error ? error.message : mutation.failureTitle
        setError(message)
        showErrorToast(mutation.failureTitle, message)
      }
    },
    [fetchSavedConnections]
  )

  const commitEditing = useCallback(async () => {
    if (!editingGroup) return

    const trimmedName = editingGroup.value.trim()

    if (editingGroup.mode === 'create') {
      // Clear state immediately (matches original optimistic UX)
      setEditingGroup(null)
      if (!trimmedName) return
      await runGroupMutation({
        run: () => createConnectionGroup(trimmedName),
        successTitle: 'Group created',
        failureTitle: 'Failed to create group',
        groupName: trimmedName,
      })
      return
    }

    if (trimmedName) {
      const groupId = editingGroup.groupId
      await runGroupMutation({
        run: () => updateConnectionGroup(groupId, trimmedName),
        successTitle: 'Group renamed',
        failureTitle: 'Failed to rename group',
        groupName: trimmedName,
      })
    }
    setEditingGroup(null)
  }, [editingGroup, runGroupMutation])

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
        showSuccessToast('Group deleted')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete group'
        setError(message)
        showErrorToast('Failed to delete group', message)
      }
    },
    [fetchSavedConnections]
  )

  const handleCreateGroup = useCallback(() => {
    setEditingGroup({ mode: 'create', value: '' })
  }, [])

  const renderConnectionItem = (connection: SavedConnection) => {
    const isSelected = connection.id === selectedConnectionId
    const titleText = connection.name.trim() ? connection.name : connection.host
    const showSubtitle = Boolean(connection.name.trim())
    return (
      <div
        key={connection.id}
        className={`${styles.connectionItem} ${isSelected ? styles.connectionItemSelected : ''}`}
        onClick={() => onSelectConnection(connection)}
        onContextMenu={(event) => handleConnectionContextMenu(event, connection)}
        role="button"
        data-testid="connection-list-item"
        tabIndex={0}
        onKeyDown={(event) => {
          if (isActivationKey(event.key)) {
            event.preventDefault()
            onSelectConnection(connection)
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
        {showSubtitle && <span className={styles.connectionHost}>{connection.host}</span>}
        <div className={styles.itemActions}>
          <IconButton
            size="sm"
            title="Duplicate connection"
            aria-label={`Duplicate ${titleText}`}
            onClick={(event) => {
              event.stopPropagation()
              handleDuplicateConnection(connection)
            }}
          >
            <Copy size={16} weight="regular" />
          </IconButton>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.searchWrapper}>
          <span className={styles.searchIcon}>
            <MagnifyingGlass size={16} weight="regular" />
          </span>
          <TextInput
            type="text"
            className={styles.searchInput}
            placeholder="Filter connections"
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            data-testid="connection-filter-input"
            aria-label="Filter connections"
          />
          {filterText && (
            <IconButton
              size="sm"
              className={styles.clearButton}
              onClick={() => setFilterText('')}
              tabIndex={-1}
              aria-label="Clear connection filter"
              data-testid="connection-filter-clear"
            >
              <X size={16} weight="regular" />
            </IconButton>
          )}
        </div>
        <IconButton
          size="lg"
          onClick={onNewConnection}
          title="New connection"
          aria-label="New connection"
        >
          <Plus size={16} weight="regular" />
        </IconButton>
        <IconButton size="lg" onClick={handleCreateGroup} title="New group" aria-label="New group">
          <FolderPlus size={16} weight="regular" />
        </IconButton>
      </div>
      <div className={styles.list}>
        {filterText.trim() && !hasMatches && (
          <div className={styles.emptyState}>No connections match “{filterText.trim()}”</div>
        )}
        {sections.map((section) => {
          const renameValue = sectionRenameValue(section, editingGroup)
          const isRenaming = renameValue !== null
          if (
            shouldHideSection({
              section: section,
              isFiltering: isFiltering,
              isRenaming: isRenaming,
            })
          )
            return null

          return (
            <div key={sectionKey(section)} className={styles.group}>
              <div className={styles.groupHeader} onContextMenu={groupHeaderContextMenu(section)}>
                {renameValue !== null ? (
                  <GroupInlineInput
                    value={renameValue}
                    onChange={(value) =>
                      setEditingGroup((previous) =>
                        previous ? { ...previous, value: value } : null
                      )
                    }
                    onCommit={() => void commitEditing()}
                    onCancel={cancelEditing}
                    ariaLabel="Group name"
                  />
                ) : (
                  <span className={styles.groupName}>{sectionTitle(section)}</span>
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
                onChange={(value) =>
                  setEditingGroup((previous) => (previous ? { ...previous, value: value } : null))
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

      <div className={styles.storageFooter}>
        <ShieldCheck size={16} weight="regular" className={styles.storageIcon} aria-hidden />
        <span>Encrypted storage active</span>
      </div>

      {error && (
        <InfoBar
          severity="error"
          className={styles.errorBanner}
          message={error}
          actions={
            <IconButton size="sm" onClick={() => setError(null)} aria-label="Dismiss error">
              <X size={16} weight="regular" />
            </IconButton>
          }
        />
      )}

      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="ui-context-menu"
            data-testid="saved-connections-context-menu"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              position: getContextMenuPositionMode(contextMenu.portalRoot),
            }}
            role="menu"
          >
            {contextMenu.type === 'group' && (
              <>
                <Button
                  variant="bare"
                  className="ui-context-menu__item"
                  role="menuitem"
                  onClick={() => handleRenameGroup(contextMenu.groupId)}
                >
                  <PencilSimple
                    className="ui-context-menu__icon"
                    size={18}
                    weight="regular"
                    aria-hidden
                  />
                  <span>Rename</span>
                </Button>
                <div
                  className="ui-context-menu__separator"
                  role="separator"
                  aria-orientation="horizontal"
                />
                <Button
                  variant="bare"
                  className="ui-context-menu__item ui-context-menu__item--destructive"
                  role="menuitem"
                  onClick={() => void handleDeleteGroup(contextMenu.groupId)}
                >
                  <Trash className="ui-context-menu__icon" size={18} weight="regular" aria-hidden />
                  <span>Delete</span>
                </Button>
              </>
            )}
            {contextMenu.type === 'connection' && (
              <Button
                variant="bare"
                className="ui-context-menu__item"
                role="menuitem"
                onClick={() => handleDuplicateConnection(contextMenu.connection)}
              >
                <Copy className="ui-context-menu__icon" size={18} weight="regular" aria-hidden />
                <span>Duplicate</span>
              </Button>
            )}
          </div>,
          contextMenu.portalRoot
        )}
    </div>
  )
}
