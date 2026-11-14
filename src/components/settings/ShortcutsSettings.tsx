import { SettingsSection } from './SettingsSection'
import styles from './ShortcutsSettings.module.css'
import { ACTION_DESCRIPTORS } from './shortcuts-settings/shortcut-model'
import { ShortcutRow } from './shortcuts-settings/ShortcutRow'
import { useShortcutRecording } from './shortcuts-settings/use-shortcut-recording'

export function ShortcutsSettings() {
  const shortcuts = useShortcutRecording()
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
            {ACTION_DESCRIPTORS.map((action) => (
              <ShortcutRow key={action.id} action={action} shortcuts={shortcuts} />
            ))}
          </tbody>
        </table>
      </SettingsSection>
    </div>
  )
}
