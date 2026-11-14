import { Button } from '../../common/Button'
import { KeyCapBadge } from '../KeyCapBadge'
import type { ShortcutActionDescriptor, ShortcutBinding } from '../../../types/schema'
import { defaultBindingLabel, isModifiedShortcut } from './shortcut-model'
import type { ShortcutRecording } from './use-shortcut-recording'
import styles from '../ShortcutsSettings.module.css'

const CONFLICT_BUTTON_STYLE = { fontSize: 'var(--type-size-xs)', padding: '2px 6px' }

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

function ConflictNotice({ actionId, onResolve }: { actionId: string; onResolve: () => void }) {
  return (
    <span className={styles.conflict}>
      Conflict!{' '}
      <Button
        variant="subtle"
        size="sm"
        onClick={() => onResolve()}
        data-testid={`shortcut-resolve-${actionId}`}
        style={CONFLICT_BUTTON_STYLE}
      >
        Reassign
      </Button>
    </span>
  )
}

interface ShortcutRowProps {
  action: ShortcutActionDescriptor
  shortcuts: ShortcutRecording
}

export function ShortcutRow({ action, shortcuts }: ShortcutRowProps) {
  const { id, label, description } = action
  const { recording, workingShortcuts } = shortcuts
  const hasConflict = recording.conflict?.conflictActionId === id
  return (
    <tr data-testid={`shortcut-row-${id}`}>
      <td>
        <div>{label}</div>
        <div className={styles.actionDescription}>{description}</div>
      </td>
      <td>
        <div className={styles.shortcutCell}>
          <ShortcutBindingButton
            actionId={id}
            binding={workingShortcuts[id]}
            isRecording={recording.recordingActionId === id}
            onCancelRecording={shortcuts.cancelRecording}
            onStartRecording={() => shortcuts.startRecording(id)}
          />
          {hasConflict && <ConflictNotice actionId={id} onResolve={shortcuts.resolveConflict} />}
        </div>
      </td>
      <td>
        {isModifiedShortcut(workingShortcuts, id) && (
          <Button
            variant="bare"
            className={styles.resetButton}
            data-testid={`shortcut-reset-${id}`}
            onClick={() => shortcuts.resetShortcut(id)}
            title={`Reset to default (${defaultBindingLabel(id)})`}
          >
            Reset
          </Button>
        )}
      </td>
    </tr>
  )
}
