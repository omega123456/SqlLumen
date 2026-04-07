import { TextInput } from '../common/TextInput'
import { SettingsSection } from './SettingsSection'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'

export function ResultsSettings() {
  const setPendingChange = useSettingsStore((s) => s.setPendingChange)

  const pageSize = useSettingValue('results.pageSize')
  const nullDisplay = useSettingValue('results.nullDisplay')

  return (
    <div data-testid="settings-results">
      <SettingsSection title="Data Grid" description="Customize how query results are displayed.">
        <div>
          <label
            htmlFor="settings-page-size"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            Page size (rows per page)
          </label>
          <TextInput
            id="settings-page-size"
            type="number"
            min={10}
            max={10000}
            value={pageSize}
            onChange={(e) => setPendingChange('results.pageSize', e.target.value)}
            data-testid="settings-page-size"
            style={{ width: 120 }}
          />
        </div>
        <div>
          <label
            htmlFor="settings-null-display"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            NULL display text
          </label>
          <TextInput
            id="settings-null-display"
            value={nullDisplay}
            onChange={(e) => setPendingChange('results.nullDisplay', e.target.value)}
            data-testid="settings-null-display"
            style={{ width: 200 }}
          />
        </div>
      </SettingsSection>
    </div>
  )
}
