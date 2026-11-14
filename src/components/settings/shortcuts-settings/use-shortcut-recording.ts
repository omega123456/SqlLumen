import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { useShortcutStore, DEFAULT_SHORTCUTS } from '../../../stores/shortcut-store'
import { useSettingsStore } from '../../../stores/settings-store'
import type { ShortcutBinding } from '../../../types/schema'
import {
  IDLE_RECORDING,
  bindingFromKeyEvent,
  findConflict,
  isModifierKey,
  parsePendingShortcuts,
  withConflictReassigned,
  type RecordingSession,
  type ShortcutMap,
} from './shortcut-model'

function useWorkingShortcuts() {
  const liveShortcuts = useShortcutStore((state) => state.shortcuts)
  const setPendingChange = useSettingsStore((state) => state.setPendingChange)
  const pendingShortcuts = useSettingsStore((state) => state.pendingChanges['shortcuts'])
  const [workingShortcuts, setWorkingShortcuts] = useState<ShortcutMap>(
    () => parsePendingShortcuts(pendingShortcuts) ?? { ...liveShortcuts }
  )

  const syncWorkingShortcutsWithPending = useEffectEvent((pending: string | undefined) => {
    if (!pending) {
      setWorkingShortcuts({ ...liveShortcuts })
      return
    }
    const parsedShortcuts = parsePendingShortcuts(pending)
    if (parsedShortcuts) setWorkingShortcuts(parsedShortcuts)
  })

  useEffect(() => {
    syncWorkingShortcutsWithPending(pendingShortcuts)
  }, [pendingShortcuts])

  const stageShortcuts = useCallback(
    (shortcuts: ShortcutMap) => {
      setWorkingShortcuts(shortcuts)
      setPendingChange('shortcuts', JSON.stringify(shortcuts))
    },
    [setPendingChange]
  )

  return { workingShortcuts, stageShortcuts }
}

function useRecordingKeyListener(
  recordingActionId: string | null,
  handleKeyDown: (event: KeyboardEvent) => void
) {
  useEffect(() => {
    if (!recordingActionId) return
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [recordingActionId, handleKeyDown])
}

function useShortcutEdits(
  workingShortcuts: ShortcutMap,
  stageShortcuts: (map: ShortcutMap) => void
) {
  const [recording, setRecording] = useState<RecordingSession>(IDLE_RECORDING)
  const cancelRecording = useCallback(() => setRecording(IDLE_RECORDING), [])

  const finishRecording = useCallback(
    (actionId: string, binding: ShortcutBinding) => {
      const conflict = findConflict(workingShortcuts, binding, actionId)
      if (conflict) {
        setRecording({
          recordingActionId: null,
          conflict: {
            conflictActionId: conflict,
            pendingActionId: actionId,
            pendingBinding: binding,
          },
        })
        return
      }
      stageShortcuts({ ...workingShortcuts, [actionId]: binding })
      setRecording(IDLE_RECORDING)
    },
    [workingShortcuts, stageShortcuts]
  )

  const resolveConflict = useCallback(() => {
    if (!recording.conflict) return
    stageShortcuts(withConflictReassigned(workingShortcuts, recording.conflict))
    setRecording(IDLE_RECORDING)
  }, [workingShortcuts, recording.conflict, stageShortcuts])

  const startRecording = useCallback((actionId: string) => {
    setRecording((current) => ({ ...current, recordingActionId: actionId }))
  }, [])

  return { recording, cancelRecording, finishRecording, resolveConflict, startRecording }
}

export function useShortcutRecording() {
  const { workingShortcuts, stageShortcuts } = useWorkingShortcuts()
  const edits = useShortcutEdits(workingShortcuts, stageShortcuts)
  const { recording, cancelRecording, finishRecording } = edits
  const { recordingActionId } = recording

  const resetShortcut = useCallback(
    (actionId: string) => {
      if (!(actionId in DEFAULT_SHORTCUTS)) return
      stageShortcuts({ ...workingShortcuts, [actionId]: DEFAULT_SHORTCUTS[actionId] })
    },
    [workingShortcuts, stageShortcuts]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!recordingActionId) return
      if (isModifierKey(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        cancelRecording()
        return
      }
      finishRecording(recordingActionId, bindingFromKeyEvent(event))
    },
    [recordingActionId, cancelRecording, finishRecording]
  )
  useRecordingKeyListener(recordingActionId, handleKeyDown)

  return { ...edits, workingShortcuts, resetShortcut }
}

export type ShortcutRecording = ReturnType<typeof useShortcutRecording>
