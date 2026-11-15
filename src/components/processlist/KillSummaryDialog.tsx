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
      <h2 className="mb-3 text-size-heading-2 font-bold">Kill results</h2>
      <p className="mb-2 wrap-break-word">
        {successes.length} {successes.length === 1 ? 'process' : 'processes'} killed successfully
      </p>
      {failures.length > 0 && (
        <ul className="mb-3 list-disc pl-5">
          {failures.map((failure) => (
            <li key={failure.id} className="text-light-error dark:text-dark-error">
              ID {failure.id}: {failure.error ?? 'Unknown error'}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Button variant="accent" onClick={onClose} data-testid="kill-summary-done-button">
          Done
        </Button>
      </div>
    </DialogShell>
  )
}
