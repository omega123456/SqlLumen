import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { logParseFallback } from '../../lib/app-log-commands'
import { bindingsMatch } from '../../lib/shortcut-bindings'
import { useShortcutStore, DEFAULT_SHORTCUTS } from '../../stores/shortcut-store'
import { useSettingsStore } from '../../stores/settings-store'
import { SettingsSection } from './SettingsSection'
import { KeyCapBadge } from './KeyCapBadge'
import { Button } from '../common/Button'
import type { ShortcutBinding, ShortcutActionDescriptor } from '../../types/schema'
import styles from './ShortcutsSettings.module.css'

/** Descriptors for all shortcut actions. */
const ACTION_DESCRIPTORS: ShortcutActionDescriptor[] = [
  { id: 'execute-query', label: 'Execute query', description: 'Run the current SQL statement' },
  {
    id: 'execute-all',
    label: 'Execute all',
    description: 'Run all statements in the editor',
  },
  { id: 'format-query', label: 'Format query', description: 'Auto-format the current SQL' },
  {
    id: 'command-palette',
    label: 'Command palette',
    description: 'Open the schema object search palette',
  },
  {
    id: 'command-palette-table',
    label: 'Search table columns',
    description: 'Open the command palette scoped to the active table',
  },
  { id: 'save-file', label: 'Save file', description: 'Save the current editor contents' },
  { id: 'open-file', label: 'Open file', description: 'Open a SQL file' },
  { id: 'new-query-tab', label: 'New query tab', description: 'Open a new query editor tab' },
  { id: 'close-tab', label: 'Close tab', description: 'Close the active workspace tab' },
  { id: 'settings', label: 'Settings', description: 'Open the settings dialog' },
  { id: 'zoom-in', label: 'Zoom in', description: 'Increase application zoom level' },
  { id: 'zoom-out', label: 'Zoom out', description: 'Decrease application zoom level' },
  { id: 'zoom-reset', label: 'Reset zoom', description: 'Reset application zoom to 100%' },
  {
    id: 'reveal-in-object-browser',
    label: 'Reveal in object browser',
    description: "Select the active tab's table, view or routine in the object browser",
  },
]

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

function isShortcutOverride(
  actionId: string,
  binding: ShortcutBinding | null
): binding is ShortcutBinding {
  return actionId in DEFAULT_SHORTCUTS && typeof binding?.key === 'string'
}

function mergeOntoDefaultShortcuts(
  storedShortcuts: Record<string, ShortcutBinding | null>
): Record<string, ShortcutBinding> {
  const merged = { ...DEFAULT_SHORTCUTS }
  for (const [actionId, binding] of Object.entries(storedShortcuts)) {
    if (isShortcutOverride(actionId, binding)) {
      merged[actionId] = binding
    }
  }
  return merged
}

function parsePendingShortcuts(
  pendingShortcuts: string | undefined
): Record<string, ShortcutBinding> | null {
  if (!pendingShortcuts) return null
  try {
    return mergeOntoDefaultShortcuts(JSON.parse(pendingShortcuts))
  } catch (error) {
    logParseFallback('[shortcuts-settings] parsePendingShortcuts', error)
    return null
  }
}

interface ShortcutBindingButtonProps {
  actionId: string
  binding: ShortcutBinding | null | undefined
  isRecording: boolean
  onCancelRecording: () => void
  onStartRecording: () => void
}

function ShortcutBindingButton({
  actionId,
  binding,
  isRecording,
  onCancelRecording,
  onStartRecording,
}: ShortcutBindingButtonProps) {
  if (isRecording) {
    return (
      <Button
        variant="bare"
        className={`${styles.recordButton} ${styles.recording}`}
        data-testid={`shortcut-recording-${actionId}`}
        onClick={() => onCancelRecording()}
      >
        Press keys...
      </Button>
    )
  }
  return (
    <Button
      variant="bare"
      className={styles.recordButton}
      data-testid={`shortcut-record-${actionId}`}
      onClick={onStartRecording}
    >
      {binding ? <KeyCapBadge binding={binding} /> : 'Unassigned'}
    </Button>
  )
}

export function ShortcutsSettings() {
  const liveShortcuts = useShortcutStore((state) => state.shortcuts)
  const setPendingChange = useSettingsStore((state) => state.setPendingChange)
  const pendingShortcuts = useSettingsStore((state) => state.pendingChanges['shortcuts'])

  const [workingShortcuts, setWorkingShortcuts] = useState<Record<string, ShortcutBinding>>(
    () => parsePendingShortcuts(pendingShortcuts) ?? { ...liveShortcuts }
  )

  const syncWorkingShortcutsWithPending = useEffectEvent((pending: string | undefined) => {
    if (!pending) {
      setWorkingShortcuts({ ...liveShortcuts })
      return
    }
    const parsedShortcuts = parsePendingShortcuts(pending)
    if (parsedShortcuts) {
      setWorkingShortcuts(parsedShortcuts)
    }
  })

  useEffect(() => {
    syncWorkingShortcutsWithPending(pendingShortcuts)
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
    if (!pendingBinding) return
    if (!pendingActionId) return
    if (!conflictActionId) return
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
    (event: KeyboardEvent) => {
      if (!recordingActionId) return

      // Ignore lone modifier presses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return

      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        cancelRecording()
        return
      }

      const modifiers: string[] = []
      if (event.ctrlKey || event.metaKey) modifiers.push('ctrl')
      if (event.shiftKey) modifiers.push('shift')
      if (event.altKey) modifiers.push('alt')

      const binding: ShortcutBinding = { key: event.key, modifiers: modifiers }
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
    const defaultBinding = DEFAULT_SHORTCUTS[actionId]
    if (!current) return false
    if (!defaultBinding) return false
    return !bindingsMatch(current, defaultBinding)
  }

  return (
    <div data-testid="settings-shortcuts">
      <SettingsSection
        title="Keyboard shortcuts"
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
                      <ShortcutBindingButton
                        actionId={id}
                        binding={binding}
                        isRecording={isRecording}
                        onCancelRecording={cancelRecording}
                        onStartRecording={() => setRecordingActionId(id)}
                      />
                      {hasConflict && (
                        <span className={styles.conflict}>
                          Conflict!{' '}
                          <Button
                            variant="subtle"
                            size="sm"
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
                      <Button
                        variant="bare"
                        className={styles.resetButton}
                        data-testid={`shortcut-reset-${id}`}
                        onClick={() => resetShortcut(id)}
                        title={`Reset to default (${defaults[id]?.modifiers.join('+')}${defaults[id]?.modifiers.length ? '+' : ''}${defaults[id]?.key})`}
                      >
                        Reset
                      </Button>
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
