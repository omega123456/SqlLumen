import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { SettingsSection } from './SettingsSection'
import { MemorySection } from './memory/MemorySection'
import type { MemoryDragPayload } from './memory/MemoryRow'
import { isConnectionOfProfile, useConnectionStore } from '../../stores/connection-store'
import {
  deleteMemory,
  listConnectionMemories,
  listGlobalMemories,
  listGroupMemories,
  moveMemory,
  saveMemory,
} from '../../lib/ai-memory-commands'
import type { AiMemory, MemoryScope } from '../../lib/ai-memory-commands'
import { showErrorToast } from '../../stores/toast-store'
import { logFrontend } from '../../lib/app-log-commands'
import styles from './AiMemoriesSettings.module.css'
import type { ActiveConnection } from '../../types/connection'

interface MemoryStore {
  global: AiMemory[]
  group: Record<string, AiMemory[]>
  connection: Record<string, AiMemory[]>
}

const EMPTY_STORE: MemoryStore = { global: [], group: {}, connection: {} }

function isConnectionInGroup(connection: ActiveConnection, groupId: string): boolean {
  return connection.profile.groupId === groupId
}

function findMemoryById(memories: AiMemory[] | undefined, memoryId: AiMemory['id']) {
  return memories?.find((candidate) => candidate.id === memoryId)
}

function findDraggedMemory(
  memories: MemoryStore,
  payload: MemoryDragPayload
): AiMemory | undefined {
  if (payload.fromScope === 'global') return findMemoryById(memories.global, payload.memoryId)
  const sourceGroupId = payload.fromScope === 'group' ? payload.fromGroupId : null
  if (sourceGroupId) {
    return findMemoryById(memories.group[sourceGroupId], payload.memoryId)
  }
  const sourceConnectionId = payload.fromScope === 'connection' ? payload.fromConnectionId : null
  if (sourceConnectionId) {
    return findMemoryById(memories.connection[sourceConnectionId], payload.memoryId)
  }
  return undefined
}

export function AiMemoriesSettings() {
  const savedConnections = useConnectionStore((state) => state.savedConnections)
  const connectionGroups = useConnectionStore((state) => state.connectionGroups)
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const fetchSavedConnections = useConnectionStore((state) => state.fetchSavedConnections)

  const [memories, setMemories] = useState<MemoryStore>(EMPTY_STORE)
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<AiMemory | null>(null)
  const [activeDrag, setActiveDrag] = useState<MemoryDragPayload | null>(null)
  const activeDragRef = useRef<MemoryDragPayload | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)

  // Ensure connections + groups are hydrated.
  useEffect(() => {
    const hasNoConnectionData = savedConnections.length === 0 && connectionGroups.length === 0
    if (hasNoConnectionData) {
      void fetchSavedConnections()
    }
  }, [savedConnections.length, connectionGroups.length, fetchSavedConnections])

  const loadMemories = useCallback(async () => {
    try {
      const [global, groupEntries, connectionEntries] = await Promise.all([
        listGlobalMemories().catch((error) => {
          logFrontend('warn', `[AiMemoriesSettings] listGlobalMemories failed: ${String(error)}`)
          return [] as AiMemory[]
        }),
        Promise.all(
          connectionGroups.map(async (group) => {
            try {
              return [group.id, await listGroupMemories({ groupId: group.id })] as const
            } catch (error) {
              logFrontend(
                'warn',
                `[AiMemoriesSettings] listGroupMemories failed for ${group.id}: ${String(error)}`
              )
              return [group.id, [] as AiMemory[]] as const
            }
          })
        ),
        Promise.all(
          savedConnections.map(async (connection) => {
            try {
              return [
                connection.id,
                await listConnectionMemories({ connectionId: connection.id }),
              ] as const
            } catch (error) {
              logFrontend(
                'warn',
                `[AiMemoriesSettings] listConnectionMemories failed for ${connection.id}: ${String(error)}`
              )
              return [connection.id, [] as AiMemory[]] as const
            }
          })
        ),
      ])
      setMemories({
        global: global,
        group: Object.fromEntries(groupEntries),
        connection: Object.fromEntries(connectionEntries),
      })
    } catch (error) {
      logFrontend('error', `[AiMemoriesSettings] Failed to load memories: ${String(error)}`)
    } finally {
      setLoading(false)
    }
  }, [savedConnections, connectionGroups])

  useEffect(() => {
    void loadMemories()
  }, [loadMemories])

  const ungroupedConnections = useMemo(
    () => savedConnections.filter((connection) => !connection.groupId),
    [savedConnections]
  )

  // Resolve an active session id whose connection matches the target owner so
  // the session-based save/embed flow targets the right scope. Backend
  // `save_memory` resolves the owner from the session, so adding to an owner
  // with no open session is not possible.
  const resolveSessionId = useCallback(
    (scope: MemoryScope, ownerId?: string): string | null => {
      const sessions = Object.entries(activeConnections)
      if (scope === 'global') {
        return sessions[0]?.[0] ?? null
      }
      if (ownerId === undefined) {
        return null
      }
      if (scope === 'connection') {
        const match = sessions.find(([, connection]) => isConnectionOfProfile(connection, ownerId))
        return match?.[0] ?? null
      }
      const match = sessions.find(([, connection]) => isConnectionInGroup(connection, ownerId))
      return match?.[0] ?? null
    },
    [activeConnections]
  )

  const handleAdd = useCallback(
    async (scope: MemoryScope, content: string, ownerId?: string) => {
      const sessionId = resolveSessionId(scope, ownerId)
      if (!sessionId) {
        showErrorToast(
          'Open a connection in this scope to add a memory here (saving requires an active connection).'
        )
        return
      }
      try {
        await saveMemory({ sessionId, content, scope })
        await loadMemories()
      } catch (error) {
        showErrorToast(`Failed to save memory: ${String(error)}`)
      }
    },
    [resolveSessionId, loadMemories]
  )

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await deleteMemory({ scope: deleteTarget.scope, memoryId: deleteTarget.id })
      await loadMemories()
    } catch (error) {
      showErrorToast(`Failed to delete memory: ${String(error)}`)
    } finally {
      setDeleteTarget(null)
    }
  }, [deleteTarget, loadMemories])

  const performMove = useCallback(
    async (
      memory: AiMemory,
      fromScope: MemoryScope,
      target: { scope: MemoryScope; connectionId?: string; groupId?: string }
    ) => {
      try {
        await moveMemory({
          memoryId: memory.id,
          fromScope: fromScope,
          toScope: target.scope,
          toGroupId: target.groupId,
          toConnectionId: target.connectionId,
          fromGroupId: memory.groupId ?? undefined,
          fromConnectionId: memory.connectionId ?? undefined,
        })
        await loadMemories()
      } catch (error) {
        showErrorToast(`Failed to move memory: ${String(error)}`)
      }
    },
    [loadMemories]
  )

  const handleDrop = useCallback(
    (
      target: { scope: MemoryScope; connectionId?: string; groupId?: string },
      payload: MemoryDragPayload
    ) => {
      const memory = findDraggedMemory(memories, payload)
      activeDragRef.current = null
      setActiveDrag(null)
      setHoverKey(null)
      if (!memory) return
      void performMove(memory, payload.fromScope, target)
    },
    [memories, performMove]
  )

  const sharedDnd = {
    activeDrag: activeDrag,
    getActiveDrag: () => activeDragRef.current,
    hoverKey: hoverKey,
    onHover: setHoverKey,
    onDragStart: (payload: MemoryDragPayload) => {
      activeDragRef.current = payload
      setActiveDrag(payload)
    },
    onDragEnd: () => {
      activeDragRef.current = null
      setActiveDrag(null)
      setHoverKey(null)
    },
    onDrop: handleDrop,
  }

  if (loading) return null

  return (
    <div data-testid="ai-memories-settings">
      <SettingsSection title="Memories" description="Notes the AI uses, organised by scope.">
        <div className={styles.tree}>
          {/* Global */}
          <MemorySection
            sectionKey="global"
            scope="global"
            label="Global"
            memories={memories.global}
            onRequestDelete={setDeleteTarget}
            onAdd={(content) => handleAdd('global', content)}
            {...sharedDnd}
          />

          {/* Per-group sections */}
          {connectionGroups.map((group) => {
            const groupConnections = savedConnections.filter(
              (connection) => connection.groupId === group.id
            )
            return (
              <MemorySection
                key={group.id}
                sectionKey={`group-${group.id}`}
                scope="group"
                label={group.name}
                groupId={group.id}
                memories={memories.group[group.id] ?? []}
                collapsible
                nested
                onRequestDelete={setDeleteTarget}
                onAdd={(content) => handleAdd('group', content, group.id)}
                {...sharedDnd}
              >
                {groupConnections.map((connection) => (
                  <MemorySection
                    key={connection.id}
                    sectionKey={`connection-${connection.id}`}
                    scope="connection"
                    label={connection.name}
                    connectionId={connection.id}
                    nested
                    subdued
                    memories={memories.connection[connection.id] ?? []}
                    onRequestDelete={setDeleteTarget}
                    onAdd={(content) => handleAdd('connection', content, connection.id)}
                    {...sharedDnd}
                  />
                ))}
              </MemorySection>
            )
          })}

          {/* Ungrouped connections — a tier-1 "No group" block parallel to real groups */}
          {ungroupedConnections.length > 0 && (
            <div className={styles.ungroupedBlock}>
              <div className={styles.ungroupedLabel} data-testid="ai-memory-ungrouped-label">
                No group
              </div>
              {ungroupedConnections.map((connection) => (
                <MemorySection
                  key={connection.id}
                  sectionKey={`connection-${connection.id}`}
                  scope="connection"
                  label={connection.name}
                  connectionId={connection.id}
                  nested
                  subdued
                  memories={memories.connection[connection.id] ?? []}
                  onRequestDelete={setDeleteTarget}
                  onAdd={(content) => handleAdd('connection', content, connection.id)}
                  {...sharedDnd}
                />
              ))}
            </div>
          )}
        </div>
      </SettingsSection>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete memory"
        message="Are you sure you want to delete this memory?"
        confirmLabel="Delete"
        isDestructive
        warningText={null}
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
