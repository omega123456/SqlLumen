import { Button } from '../../common/Button'
import { KeyCapBadge } from '../KeyCapBadge'
import type { ShortcutActionDescriptor, ShortcutBinding } from '../../../types/schema'
import { defaultBindingLabel, isModifiedShortcut } from './shortcut-model'
import type { ShortcutRecording } from './use-shortcut-recording'
import { joinClassNames } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'

type RecordButtonState = 'idle' | 'recording'

const RECORD_BUTTON_STATE_CLASSES: Record<RecordButtonState, string> = {
  idle: 'border-light-outline-variant text-light-on-surface-variant hover:border-light-primary hover:text-light-primary dark:border-dark-outline-variant dark:text-dark-on-surface-variant dark:hover:border-dark-primary dark:hover:text-dark-primary',
  recording:
    'animate-pulse border-light-primary text-light-primary window-blurred:animate-pulse-paused dark:border-dark-primary dark:text-dark-primary',
}

function recordButtonClassName(state: RecordButtonState): string {
  return joinClassNames([
    'cursor-pointer rounded-control border border-dashed bg-transparent px-2.5 py-1 text-size-caption whitespace-nowrap transition-border-color-and-color duration-120',
    FOCUS_RING,
    RECORD_BUTTON_STATE_CLASSES[state],
  ])
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
        className={recordButtonClassName('recording')}
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
      className={recordButtonClassName('idle')}
      data-testid={`shortcut-record-${actionId}`}
      onClick={onStartRecording}
    >
      {binding ? <KeyCapBadge binding={binding} /> : 'Unassigned'}
    </Button>
  )
}

function ConflictNotice({ actionId, onResolve }: { actionId: string; onResolve: () => void }) {
  return (
    <span className="font-body text-size-caption text-light-error dark:text-dark-error">
      Conflict!{' '}
      <Button
        variant="subtle"
        size="chip"
        onClick={() => onResolve()}
        data-testid={`shortcut-resolve-${actionId}`}
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
    <tr
      className="*:border-b *:border-light-stroke-divider *:px-3 *:py-2.5 *:align-middle *:text-size-caption *:text-light-on-surface dark:*:border-dark-stroke-divider dark:*:text-dark-on-surface"
      data-testid={`shortcut-row-${id}`}
    >
      <td>
        <div>{label}</div>
        <div className="text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
          {description}
        </div>
      </td>
      <td>
        <div className="flex items-center gap-2">
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
            className={joinClassNames([
              'cursor-pointer rounded-control bg-transparent px-2 py-1 text-size-caption whitespace-nowrap text-light-on-surface-variant hover:bg-light-fill-subtle-hover hover:text-light-primary dark:text-dark-on-surface-variant dark:hover:bg-dark-fill-subtle-hover dark:hover:text-dark-primary',
              FOCUS_RING,
            ])}
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
