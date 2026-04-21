import { Button } from '../common/Button'
import { DialogShell } from '../dialogs/DialogShell'
import type { KillResult } from '../../lib/processlist-commands'

export interface KillSummaryDialogProps {
  results: KillResult[] | null
  onClose: () => void
}

export function KillSummaryDialog({ results, onClose }: KillSummaryDialogProps) {
  if (!results) return null

  const successes = results.filter((r) => r.success)
  const failures = results.filter((r) => !r.success)

  return (
    <DialogShell
      isOpen={true}
      onClose={onClose}
      maxWidth={420}
      testId="kill-summary-dialog"
      ariaLabel="Kill Results"
    >
      <h2 style={{ margin: '0 0 12px' }}>Kill Results</h2>
      <p style={{ margin: '0 0 8px' }}>
        {successes.length} {successes.length === 1 ? 'process' : 'processes'} killed successfully
      </p>
      {failures.length > 0 && (
        <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
          {failures.map((f) => (
            <li key={f.id} style={{ color: 'var(--error)' }}>
              ID {f.id}: {f.error ?? 'Unknown error'}
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={onClose} data-testid="kill-summary-done-button">
          Done
        </Button>
      </div>
    </DialogShell>
  )
}
