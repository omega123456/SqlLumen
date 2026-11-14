import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { SettingsSection } from './SettingsSection'
import { MemoryTree } from './ai-memories/MemoryTree'
import { useMemoryActions } from './ai-memories/use-memory-actions'
import { useMemoryDragState } from './ai-memories/use-memory-drag-state'
import { useMemoryStore } from './ai-memories/use-memory-store'

export function AiMemoriesSettings() {
  const { savedConnections, connectionGroups, memories, loading, loadMemories } = useMemoryStore()
  const { handleAdd, deleteTarget, setDeleteTarget, handleDeleteConfirm, performMove } =
    useMemoryActions(loadMemories)
  const dragState = useMemoryDragState(memories, performMove)

  if (loading) return null

  return (
    <div data-testid="ai-memories-settings">
      <SettingsSection title="Memories" description="Notes the AI uses, organised by scope.">
        <MemoryTree
          memories={memories}
          connectionGroups={connectionGroups}
          savedConnections={savedConnections}
          handlers={{
            dragState: dragState,
            onRequestDelete: setDeleteTarget,
            onAdd: handleAdd,
          }}
        />
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
