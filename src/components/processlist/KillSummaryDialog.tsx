import { Button } from '../common/Button'
import { DialogShell } from '../dialogs/DialogShell'
import type { KillResult } from '../../lib/processlist-commands'

export interface KillSummaryDialogProps {
  results: KillResult[] | null
  onClose: () => void
}

export function KillSummaryDialog({ results, onClose }: KillSummaryDialogProps) {
  if (!results) return null

  const successes = results.filter((result) => result.success)
  const failures = results.filter((result) => !result.success)

  return (
    <DialogShell
      isOpen={true}
      onClose={onClose}
      maxWidth={420}
      testId="kill-summary-dialog"
      ariaLabel="Kill results"
    >
      <h2 style={{ margin: '0 0 12px' }}>Kill results</h2>
      <p style={{ margin: '0 0 8px' }}>
        {successes.length} {successes.length === 1 ? 'process' : 'processes'} killed successfully
      </p>
      {failures.length > 0 && (
        <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
          {failures.map((failure) => (
            <li key={failure.id} style={{ color: 'var(--error)' }}>
              ID {failure.id}: {failure.error ?? 'Unknown error'}
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="accent" onClick={onClose} data-testid="kill-summary-done-button">
          Done
        </Button>
      </div>
    </DialogShell>
  )
}
