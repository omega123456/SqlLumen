import { SettingsSection } from './SettingsSection'
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
        <table className="w-full border-collapse">
          <thead>
            <tr className="*:border-b *:border-light-outline-variant *:px-3 *:py-2 *:text-left *:text-size-caption *:font-semibold *:text-light-on-surface-variant dark:*:border-dark-outline-variant dark:*:text-dark-on-surface-variant">
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
