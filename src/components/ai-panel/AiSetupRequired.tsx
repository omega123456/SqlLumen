import { GearSix } from '@phosphor-icons/react'
import { useSettingsStore } from '../../stores/settings-store'
import { Button } from '../common/Button'
import styles from './AiSetupRequired.module.css'

export function AiSetupRequired() {
  return (
    <div className={styles.container} data-testid="ai-setup-required">
      <div className={styles.iconWrapper}>
        <GearSix size={48} weight="duotone" />
      </div>
      <h3 className={styles.headline}>Set up your embedding model</h3>
      <p className={styles.subtext}>
        An embedding model is required for AI-powered schema search. Select one in AI Settings to
        get started.
      </p>
      <Button
        variant="secondary"
        onClick={() => useSettingsStore.getState().openDialog('ai')}
        data-testid="ai-setup-open-settings"
      >
        Open AI Settings
      </Button>
    </div>
  )
}
