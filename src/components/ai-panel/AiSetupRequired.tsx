import { GearSix } from '@phosphor-icons/react'
import { useSettingsStore } from '../../stores/settings-store'
import { Button } from '../common/Button'

export function AiSetupRequired() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
      data-testid="ai-setup-required"
    >
      <div className="text-light-on-surface-variant opacity-30 dark:text-dark-on-surface-variant">
        <GearSix size={48} weight="duotone" />
      </div>
      <h3 className="font-headline text-size-body font-semibold wrap-break-word text-light-on-surface dark:text-dark-on-surface">
        Set up your embedding model
      </h3>
      <p className="max-w-70 text-size-caption leading-body wrap-break-word text-light-on-surface-variant opacity-60 dark:text-dark-on-surface-variant">
        An embedding model is required for AI-powered schema search. Select one in AI Settings to
        get started.
      </p>
      <Button
        onClick={() => useSettingsStore.getState().openDialog('ai')}
        data-testid="ai-setup-open-settings"
      >
        Open AI Settings
      </Button>
    </div>
  )
}
