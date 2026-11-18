import { Button } from '../../common/Button'

interface SaveBarProps {
  label: string
  saveLabel: string
  isSaving: boolean
  onDiscard: () => void
  onSave: () => void
}

export function SaveBar({ label, saveLabel, isSaving, onDiscard, onSave }: SaveBarProps) {
  return (
    <div
      className="sticky bottom-0 border-t border-light-stroke-divider bg-light-surface dark:border-dark-stroke-divider dark:bg-dark-surface"
      data-testid="save-bar"
    >
      <div className="mx-auto flex h-save-bar w-full max-w-connections-page items-center justify-between gap-4 px-10">
        <span className="text-body text-light-on-surface-variant dark:text-dark-on-surface-variant">
          {label}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="subtle" onClick={onDiscard}>
            Discard
          </Button>
          <Button variant="accent" onClick={onSave} disabled={isSaving}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
