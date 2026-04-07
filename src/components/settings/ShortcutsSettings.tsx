import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShortcutStore, DEFAULT_SHORTCUTS } from '../../stores/shortcut-store'
import { useSettingsStore } from '../../stores/settings-store'
import { SettingsSection } from './SettingsSection'
import { KeyCapBadge } from './KeyCapBadge'
import { Button } from '../common/Button'
import type { ShortcutBinding, ShortcutActionDescriptor } from '../../types/schema'
import styles from './ShortcutsSettings.module.css'

/** Descriptors for all shortcut actions. */
const ACTION_DESCRIPTORS: ShortcutActionDescriptor[] = [
  { id: 'execute-query', label: 'Execute Query', description: 'Run the current SQL statement' },
  {
    id: 'execute-all',
    label: 'Execute All',
    description: 'Run all statements in the editor',
  },
  { id: 'format-query', label: 'Format Query', description: 'Auto-format the current SQL' },
  { id: 'save-file', label: 'Save File', description: 'Save the current editor contents' },
  { id: 'open-file', label: 'Open File', description: 'Open a SQL file' },
  { id: 'new-query-tab', label: 'New Query Tab', description: 'Open a new query editor tab' },
  { id: 'close-tab', label: 'Close Tab', description: 'Close the active workspace tab' },
  { id: 'settings', label: 'Settings', description: 'Open the settings dialog' },
]

/** Check if two bindings are the same key combo. */
function bindingsMatch(a: ShortcutBinding, b: ShortcutBinding): boolean {
  if (a.key.toLowerCase() !== b.key.toLowerCase()) return false
  const aMods = [...a.modifiers].sort()
  const bMods = [...b.modifiers].sort()
  if (aMods.length !== bMods.length) return false
  return aMods.every((m, i) => m === bMods[i])
}

/** Find an action ID that already uses a given binding (excluding `excludeActionId`). */
function findConflict(
  shortcuts: Record<string, ShortcutBinding>,
  binding: ShortcutBinding,
  excludeActionId: string
): string | null {
  for (const [actionId, existing] of Object.entries(shortcuts)) {
    if (actionId === excludeActionId) continue
    if (bindingsMatch(existing, binding)) return actionId
  }
  return null
}

export function ShortcutsSettings() {
  const liveShortcuts = useShortcutStore((s) => s.shortcuts)
  const setPendingChange = useSettingsStore((s) => s.setPendingChange)
  const pendingShortcuts = useSettingsStore((s) => s.pendingChanges['shortcuts'])

  // Local working state — initialized from pending changes if present, else from live shortcuts
  const [workingShortcuts, setWorkingShortcuts] = useState<Record<string, ShortcutBinding>>(() => {
    if (pendingShortcuts) {
      try {
        const parsed = JSON.parse(pendingShortcuts) as Record<string, ShortcutBinding>
        const merged = { ...DEFAULT_SHORTCUTS }
        for (const [actionId, binding] of Object.entries(parsed)) {
          if (actionId in merged && binding && typeof binding.key === 'string') {
            merged[actionId] = binding
          }
        }
        return merged
      } catch {
        return { ...liveShortcuts }
      }
    }
    return { ...liveShortcuts }
  })

  // Re-initialize when pendingShortcuts changes externally (e.g. reset section)
  useEffect(() => {
    if (pendingShortcuts) {
      try {
        const parsed = JSON.parse(pendingShortcuts) as Record<string, ShortcutBinding>
        const merged = { ...DEFAULT_SHORTCUTS }
        for (const [actionId, binding] of Object.entries(parsed)) {
          if (actionId in merged && binding && typeof binding.key === 'string') {
            merged[actionId] = binding
          }
        }
        setWorkingShortcuts(merged)
      } catch {
        // ignore parse errors
      }
    } else {
      // No pending changes — reset to live shortcuts
      setWorkingShortcuts({ ...liveShortcuts })
    }
    // Only react to pendingShortcuts changes, not liveShortcuts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShortcuts])

  const [recordingActionId, setRecordingActionId] = useState<string | null>(null)
  const [conflictActionId, setConflictActionId] = useState<string | null>(null)
  const [pendingBinding, setPendingBinding] = useState<ShortcutBinding | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)

  /** Stage changes to settings store so Save becomes enabled. */
  const stageShortcuts = useCallback(
    (shortcuts: Record<string, ShortcutBinding>) => {
      setWorkingShortcuts(shortcuts)
      setPendingChange('shortcuts', JSON.stringify(shortcuts))
    },
    [setPendingChange]
  )

  const cancelRecording = useCallback(() => {
    setRecordingActionId(null)
    setConflictActionId(null)
    setPendingBinding(null)
    setPendingActionId(null)
  }, [])

  const finishRecording = useCallback(
    (actionId: string, binding: ShortcutBinding) => {
      const conflict = findConflict(workingShortcuts, binding, actionId)
      if (conflict) {
        setConflictActionId(conflict)
        setPendingBinding(binding)
        setPendingActionId(actionId)
        setRecordingActionId(null)
        return
      }
      const updated = { ...workingShortcuts, [actionId]: binding }
      stageShortcuts(updated)
      setRecordingActionId(null)
      setConflictActionId(null)
      setPendingBinding(null)
      setPendingActionId(null)
    },
    [workingShortcuts, stageShortcuts]
  )

  const resolveConflict = useCallback(() => {
    if (!pendingBinding || !pendingActionId || !conflictActionId) return
    const updated = { ...workingShortcuts }
    updated[pendingActionId] = pendingBinding
    updated[conflictActionId] = DEFAULT_SHORTCUTS[conflictActionId] ?? {
      key: '',
      modifiers: [],
    }
    stageShortcuts(updated)
    setConflictActionId(null)
    setPendingBinding(null)
    setPendingActionId(null)
    setRecordingActionId(null)
  }, [workingShortcuts, pendingBinding, pendingActionId, conflictActionId, stageShortcuts])

  const resetShortcut = useCallback(
    (actionId: string) => {
      if (actionId in DEFAULT_SHORTCUTS) {
        const updated = { ...workingShortcuts, [actionId]: DEFAULT_SHORTCUTS[actionId] }
        stageShortcuts(updated)
      }
    },
    [workingShortcuts, stageShortcuts]
  )

  /** Handle keydown events during recording. */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!recordingActionId) return

      // Ignore lone modifier presses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return

      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        cancelRecording()
        return
      }

      const modifiers: string[] = []
      if (e.ctrlKey || e.metaKey) modifiers.push('ctrl')
      if (e.shiftKey) modifiers.push('shift')
      if (e.altKey) modifiers.push('alt')

      const binding: ShortcutBinding = { key: e.key, modifiers }
      finishRecording(recordingActionId, binding)
    },
    [recordingActionId, cancelRecording, finishRecording]
  )

  useEffect(() => {
    if (!recordingActionId) return
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [recordingActionId, handleKeyDown])

  const defaults = useMemo(() => DEFAULT_SHORTCUTS, [])

  const isModified = (actionId: string): boolean => {
    const current = workingShortcuts[actionId]
    const def = DEFAULT_SHORTCUTS[actionId]
    if (!current || !def) return false
    if (current.key.toLowerCase() !== def.key.toLowerCase()) return true
    const cMods = [...current.modifiers].sort()
    const dMods = [...def.modifiers].sort()
    if (cMods.length !== dMods.length) return true
    return !cMods.every((m, i) => m === dMods[i])
  }

  return (
    <div data-testid="settings-shortcuts">
      <SettingsSection
        title="Keyboard Shortcuts"
        description="Customize keyboard shortcuts. Click on a shortcut to record a new binding."
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Action</th>
              <th>Shortcut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ACTION_DESCRIPTORS.map(({ id, label, description }) => {
              const binding = workingShortcuts[id]
              const isRecording = recordingActionId === id
              const hasConflict = conflictActionId === id

              return (
                <tr key={id} data-testid={`shortcut-row-${id}`}>
                  <td>
                    <div>{label}</div>
                    <div className={styles.actionDescription}>{description}</div>
                  </td>
                  <td>
                    <div className={styles.shortcutCell}>
                      {isRecording ? (
                        <button
                          type="button"
                          className={`${styles.recordButton} ${styles.recording}`}
                          data-testid={`shortcut-recording-${id}`}
                          onClick={() => cancelRecording()}
                        >
                          Press keys...
                        </button>
                      ) : binding ? (
                        <button
                          type="button"
                          className={styles.recordButton}
                          data-testid={`shortcut-record-${id}`}
                          onClick={() => setRecordingActionId(id)}
                        >
                          <KeyCapBadge binding={binding} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.recordButton}
                          data-testid={`shortcut-record-${id}`}
                          onClick={() => setRecordingActionId(id)}
                        >
                          Unassigned
                        </button>
                      )}
                      {hasConflict && (
                        <span className={styles.conflict}>
                          Conflict!{' '}
                          <Button
                            variant="ghost"
                            onClick={() => resolveConflict()}
                            data-testid={`shortcut-resolve-${id}`}
                            style={{ fontSize: 'var(--type-size-xs)', padding: '2px 6px' }}
                          >
                            Reassign
                          </Button>
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    {isModified(id) && (
                      <button
                        type="button"
                        className={styles.resetButton}
                        data-testid={`shortcut-reset-${id}`}
                        onClick={() => resetShortcut(id)}
                        title={`Reset to default (${defaults[id]?.modifiers.join('+')}${defaults[id]?.modifiers.length ? '+' : ''}${defaults[id]?.key})`}
                      >
                        Reset
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </SettingsSection>
    </div>
  )
}
