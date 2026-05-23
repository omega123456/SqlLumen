import { Dropdown } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { SettingsSection } from './SettingsSection'
import { SettingsToggle } from './SettingsToggle'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'

const CACHE_TTL_OPTIONS = [
  { label: '15 minutes', value: '900' },
  { label: '30 minutes', value: '1800' },
  { label: '1 hour', value: '3600' },
  { label: '2 hours', value: '7200' },
  { label: '4 hours', value: '14400' },
]

export function ResultsSettings() {
  const setPendingChange = useSettingsStore((s) => s.setPendingChange)

  const pageSize = useSettingValue('results.pageSize')
  const nullDisplay = useSettingValue('results.nullDisplay')
  const tableTabsInBottomPanel = useSettingValue('results.tableTabsInBottomPanel')
  const cacheTTL = useSettingValue('results.cacheTTL')

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
      <SettingsSection
        title="Result Cache"
        description="Control how long query results are kept in memory before being discarded."
      >
        <div>
          <label
            id="cache-ttl-label"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            Cache duration
          </label>
          <div style={{ width: 200 }}>
            <Dropdown
              id="settings-cache-ttl"
              labelledBy="cache-ttl-label"
              options={CACHE_TTL_OPTIONS}
              value={cacheTTL}
              onChange={(value) => setPendingChange('results.cacheTTL', value)}
              data-testid="settings-cache-ttl"
            />
          </div>
        </div>
      </SettingsSection>
      <SettingsSection
        title="Workspace Layout"
        description="Configure where table browsing tabs appear."
      >
        <SettingsToggle
          label="Show table data tabs in bottom panel"
          description="Show table data tabs inside the active query editor's result panel for faster switching between query results and table browsing."
          checked={tableTabsInBottomPanel === 'true'}
          onChange={(checked) =>
            setPendingChange('results.tableTabsInBottomPanel', checked ? 'true' : 'false')
          }
          data-testid="settings-table-tabs-bottom"
        />
      </SettingsSection>
    </div>
  )
}
