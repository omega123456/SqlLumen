import { useCallback, useEffect, useState } from 'react'
import { Button } from '../common/Button'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { SettingsSection } from './SettingsSection'
import { useConnectionStore } from '../../stores/connection-store'
import { listMemories, deleteMemory } from '../../lib/ai-memory-commands'
import type { AiMemory } from '../../lib/ai-memory-commands'
import { showErrorToast } from '../../stores/toast-store'
import { formatFromEpochSeconds } from '../../lib/format-utils'
import styles from './AiMemoriesSettings.module.css'

import { logFrontend } from '../../lib/app-log-commands'
interface ConnectionMemories {
  connectionId: string
  connectionName: string
  memories: AiMemory[]
}

export function AiMemoriesSettings() {
  const savedConnections = useConnectionStore((s) => s.savedConnections)
  const fetchSavedConnections = useConnectionStore((s) => s.fetchSavedConnections)
  const [data, setData] = useState<ConnectionMemories[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [deleteTarget, setDeleteTarget] = useState<{
    memoryId: number
    connectionId: string
  } | null>(null)

  // Ensure connections are hydrated
  useEffect(() => {
    if (savedConnections.length === 0) {
      void fetchSavedConnections()
    }
  }, [savedConnections.length, fetchSavedConnections])

  const loadMemories = useCallback(async () => {
    const profiles = savedConnections
    if (profiles.length === 0) {
      setData([])
      setLoading(false)
      return
    }
    try {
      const results = await Promise.all(
        profiles.map(async (p) => {
          try {
            const memories = await listMemories({ connectionId: p.id })
            return { connectionId: p.id, connectionName: p.name, memories }
          } catch (err) {
            logFrontend(
              'warn',
              `[AiMemoriesSettings] listMemories failed for connection ${p.id}: ${err instanceof Error ? err.message : String(err)}`
            )
            return { connectionId: p.id, connectionName: p.name, memories: [] }
          }
        })
      )
      setData(results.filter((r) => r.memories.length > 0))
    } catch (err) {
      logFrontend('error', `Failed to load memories: ${err}`)
    } finally {
      setLoading(false)
    }
  }, [savedConnections])

  useEffect(() => {
    void loadMemories()
  }, [loadMemories])

  const handleToggle = (connectionId: string) => {
    setExpanded((prev) => ({ ...prev, [connectionId]: !prev[connectionId] }))
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    try {
      await deleteMemory({ memoryId: deleteTarget.memoryId })
      setData((prev) =>
        prev
          .map((c) =>
            c.connectionId === deleteTarget.connectionId
              ? { ...c, memories: c.memories.filter((m) => m.id !== deleteTarget.memoryId) }
              : c
          )
          .filter((c) => c.memories.length > 0)
      )
    } catch (err) {
      showErrorToast(`Failed to delete memory: ${err}`)
    } finally {
      setDeleteTarget(null)
    }
  }

  if (loading) return null

  return (
    <div data-testid="ai-memories-settings">
      <SettingsSection title="Memories" description="Notes saved via /remember, per connection.">
        {data.length === 0 ? (
          <div className={styles.emptyState} data-testid="ai-memories-empty-state">
            No memories saved yet. Use /remember in the AI chat to save notes.
          </div>
        ) : (
          data.map((conn) => (
            <div
              key={conn.connectionId}
              className={styles.accordion}
              data-testid={`ai-memories-connection-${conn.connectionId}`}
            >
              <button
                type="button"
                className={styles.accordionHeader}
                onClick={() => handleToggle(conn.connectionId)}
                aria-expanded={!!expanded[conn.connectionId]}
              >
                {conn.connectionName} ({conn.memories.length}{' '}
                {conn.memories.length === 1 ? 'memory' : 'memories'})
              </button>
              {expanded[conn.connectionId] && (
                <div className={styles.accordionBody}>
                  {conn.memories.map((mem) => (
                    <div
                      key={mem.id}
                      className={styles.memoryItem}
                      data-testid={`ai-memory-item-${mem.id}`}
                    >
                      <div className={styles.memoryContent}>
                        <div className={styles.memoryText}>{mem.content}</div>
                        <div
                          className={styles.memoryDate}
                        >{`Saved ${formatFromEpochSeconds(mem.createdAt)}`}</div>
                      </div>
                      <div className={styles.memoryActions}>
                        <Button
                          variant="danger"
                          onClick={() =>
                            setDeleteTarget({
                              memoryId: mem.id,
                              connectionId: conn.connectionId,
                            })
                          }
                          data-testid={`ai-memory-delete-${mem.id}`}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
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
