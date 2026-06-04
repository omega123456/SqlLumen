import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { SettingsSection } from './SettingsSection'
import { MemorySection } from './memory/MemorySection'
import type { MemoryDragPayload, MoveDestination } from './memory/MemoryRow'
import { useConnectionStore } from '../../stores/connection-store'
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

interface MemoryStore {
  global: AiMemory[]
  group: Record<string, AiMemory[]>
  connection: Record<string, AiMemory[]>
}

const EMPTY_STORE: MemoryStore = { global: [], group: {}, connection: {} }

export function AiMemoriesSettings() {
  const savedConnections = useConnectionStore((s) => s.savedConnections)
  const connectionGroups = useConnectionStore((s) => s.connectionGroups)
  const activeConnections = useConnectionStore((s) => s.activeConnections)
  const fetchSavedConnections = useConnectionStore((s) => s.fetchSavedConnections)

  const [memories, setMemories] = useState<MemoryStore>(EMPTY_STORE)
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<AiMemory | null>(null)
  const [activeDrag, setActiveDrag] = useState<MemoryDragPayload | null>(null)

  // Ensure connections + groups are hydrated.
  useEffect(() => {
    if (savedConnections.length === 0 && connectionGroups.length === 0) {
      void fetchSavedConnections()
    }
  }, [savedConnections.length, connectionGroups.length, fetchSavedConnections])

  const loadMemories = useCallback(async () => {
    try {
      const [global, groupEntries, connectionEntries] = await Promise.all([
        listGlobalMemories().catch((err) => {
          logFrontend('warn', `[AiMemoriesSettings] listGlobalMemories failed: ${String(err)}`)
          return [] as AiMemory[]
        }),
        Promise.all(
          connectionGroups.map(async (g) => {
            try {
              return [g.id, await listGroupMemories({ groupId: g.id })] as const
            } catch (err) {
              logFrontend(
                'warn',
                `[AiMemoriesSettings] listGroupMemories failed for ${g.id}: ${String(err)}`
              )
              return [g.id, [] as AiMemory[]] as const
            }
          })
        ),
        Promise.all(
          savedConnections.map(async (c) => {
            try {
              return [c.id, await listConnectionMemories({ connectionId: c.id })] as const
            } catch (err) {
              logFrontend(
                'warn',
                `[AiMemoriesSettings] listConnectionMemories failed for ${c.id}: ${String(err)}`
              )
              return [c.id, [] as AiMemory[]] as const
            }
          })
        ),
      ])
      setMemories({
        global,
        group: Object.fromEntries(groupEntries),
        connection: Object.fromEntries(connectionEntries),
      })
    } catch (err) {
      logFrontend('error', `[AiMemoriesSettings] Failed to load memories: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [savedConnections, connectionGroups])

  useEffect(() => {
    void loadMemories()
  }, [loadMemories])

  const ungroupedConnections = useMemo(
    () => savedConnections.filter((c) => !c.groupId),
    [savedConnections]
  )

  // All move/drop destinations (excluding the source owner is handled per-row).
  const allDestinations = useMemo<MoveDestination[]>(() => {
    const dest: MoveDestination[] = [{ key: 'global', scope: 'global', label: 'Global' }]
    for (const g of connectionGroups) {
      dest.push({ key: `group:${g.id}`, scope: 'group', label: g.name, groupId: g.id })
    }
    for (const c of savedConnections) {
      dest.push({
        key: `connection:${c.id}`,
        scope: 'connection',
        label: c.name,
        connectionId: c.id,
      })
    }
    return dest
  }, [connectionGroups, savedConnections])

  const destinationsFor = useCallback(
    (scope: MemoryScope, ownerId?: string): MoveDestination[] =>
      allDestinations.filter((d) => {
        if (d.scope !== scope) return true
        if (scope === 'global') return false
        if (scope === 'group') return d.groupId !== ownerId
        return d.connectionId !== ownerId
      }),
    [allDestinations]
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
      if (scope === 'connection') {
        const match = sessions.find(([, c]) => c.profile.id === ownerId)
        return match?.[0] ?? null
      }
      // group
      const match = sessions.find(([, c]) => c.profile.groupId === ownerId)
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
      } catch (err) {
        showErrorToast(`Failed to save memory: ${String(err)}`)
      }
    },
    [resolveSessionId, loadMemories]
  )

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await deleteMemory({ scope: deleteTarget.scope, memoryId: deleteTarget.id })
      await loadMemories()
    } catch (err) {
      showErrorToast(`Failed to delete memory: ${String(err)}`)
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
          fromScope,
          toScope: target.scope,
          toGroupId: target.groupId,
          toConnectionId: target.connectionId,
          fromGroupId: memory.groupId ?? undefined,
          fromConnectionId: memory.connectionId ?? undefined,
        })
        await loadMemories()
      } catch (err) {
        showErrorToast(`Failed to move memory: ${String(err)}`)
      }
    },
    [loadMemories]
  )

  const handleMoveMenu = useCallback(
    (memory: AiMemory, destination: MoveDestination) => {
      void performMove(memory, memory.scope, destination)
    },
    [performMove]
  )

  const handleDrop = useCallback(
    (
      target: { scope: MemoryScope; connectionId?: string; groupId?: string },
      payload: MemoryDragPayload
    ) => {
      // Find the dragged memory across stores by id + source scope.
      let memory: AiMemory | undefined
      if (payload.fromScope === 'global') {
        memory = memories.global.find((m) => m.id === payload.memoryId)
      } else if (payload.fromScope === 'group' && payload.fromGroupId) {
        memory = memories.group[payload.fromGroupId]?.find((m) => m.id === payload.memoryId)
      } else if (payload.fromScope === 'connection' && payload.fromConnectionId) {
        memory = memories.connection[payload.fromConnectionId]?.find(
          (m) => m.id === payload.memoryId
        )
      }
      setActiveDrag(null)
      if (!memory) return
      void performMove(memory, payload.fromScope, target)
    },
    [memories, performMove]
  )

  const sharedDnd = {
    activeDrag,
    onDragStart: (payload: MemoryDragPayload) => setActiveDrag(payload),
    onDragEnd: () => setActiveDrag(null),
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
            destinations={destinationsFor('global')}
            onRequestDelete={setDeleteTarget}
            onMove={handleMoveMenu}
            onAdd={(content) => handleAdd('global', content)}
            {...sharedDnd}
          />

          {/* Per-group sections */}
          {connectionGroups.map((group) => {
            const groupConnections = savedConnections.filter((c) => c.groupId === group.id)
            return (
              <MemorySection
                key={group.id}
                sectionKey={`group-${group.id}`}
                scope="group"
                label={group.name}
                groupId={group.id}
                memories={memories.group[group.id] ?? []}
                collapsible
                destinations={destinationsFor('group', group.id)}
                onRequestDelete={setDeleteTarget}
                onMove={handleMoveMenu}
                onAdd={(content) => handleAdd('group', content, group.id)}
                {...sharedDnd}
              >
                {groupConnections.map((conn) => (
                  <MemorySection
                    key={conn.id}
                    sectionKey={`connection-${conn.id}`}
                    scope="connection"
                    label={conn.name}
                    connectionId={conn.id}
                    nested
                    memories={memories.connection[conn.id] ?? []}
                    destinations={destinationsFor('connection', conn.id)}
                    onRequestDelete={setDeleteTarget}
                    onMove={handleMoveMenu}
                    onAdd={(content) => handleAdd('connection', content, conn.id)}
                    {...sharedDnd}
                  />
                ))}
              </MemorySection>
            )
          })}

          {/* Ungrouped connections */}
          {ungroupedConnections.length > 0 && (
            <div className={styles.ungroupedLabel} data-testid="ai-memory-ungrouped-label">
              No Group
            </div>
          )}
          {ungroupedConnections.map((conn) => (
            <MemorySection
              key={conn.id}
              sectionKey={`connection-${conn.id}`}
              scope="connection"
              label={conn.name}
              connectionId={conn.id}
              nested
              memories={memories.connection[conn.id] ?? []}
              destinations={destinationsFor('connection', conn.id)}
              onRequestDelete={setDeleteTarget}
              onMove={handleMoveMenu}
              onAdd={(content) => handleAdd('connection', content, conn.id)}
              {...sharedDnd}
            />
          ))}
        </div>
      </SettingsSection>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete Memory"
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
