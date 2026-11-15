import { Dropdown } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { SettingsSection } from './SettingsSection'
import { SettingsCaption, SettingsFieldLabel } from './SettingsField'
import { SettingsToggle } from './SettingsToggle'
import {
  RESULTS_MAX_ROWS_MAX,
  RESULTS_MAX_ROWS_MIN,
  useSettingsStore,
  useSettingValue,
} from '../../stores/settings-store'
import { formatCount } from '../../lib/format-row-count'

const CACHE_TTL_OPTIONS = [
  { label: '15 minutes', value: '900' },
  { label: '30 minutes', value: '1800' },
  { label: '1 hour', value: '3600' },
  { label: '2 hours', value: '7200' },
  { label: '4 hours', value: '14400' },
]

const MAX_TABS_PER_GROUP_OPTIONS = [
  { label: 'Unlimited', value: '0' },
  { label: '3', value: '3' },
  { label: '5', value: '5' },
  { label: '10', value: '10' },
  { label: '15', value: '15' },
  { label: '20', value: '20' },
]

function parseMaxRows(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const parsed = Number(value.trim())
  const isWithinRowLimits = parsed >= RESULTS_MAX_ROWS_MIN && parsed <= RESULTS_MAX_ROWS_MAX
  return isWithinRowLimits ? parsed : null
}

function RowLimitField() {
  const setPendingChange = useSettingsStore((state) => state.setPendingChange)
  const rowLimit = useSettingValue('results.pageSize')
  const ceiling = parseMaxRows(useSettingValue('results.maxRows'))
  const rowLimitValue = Number(rowLimit)
  const rowLimitExceedsCeiling =
    ceiling !== null && Number.isFinite(rowLimitValue) && rowLimitValue > ceiling

  return (
    <div>
      <SettingsFieldLabel htmlFor="settings-page-size">Row limit</SettingsFieldLabel>
      <TextInput
        id="settings-page-size"
        type="number"
        min={10}
        max={10000}
        value={rowLimit}
        onChange={(event) => setPendingChange('results.pageSize', event.target.value)}
        aria-describedby="settings-page-size-help"
        data-testid="settings-page-size"
        fieldWidth="narrow"
      />
      <SettingsCaption id="settings-page-size-help">
        Adds a LIMIT to SELECT queries that don't have one. Capped by the maximum below.
      </SettingsCaption>
      {rowLimitExceedsCeiling && (
        <SettingsCaption data-testid="settings-page-size-capped">
          Limited to the maximum rows kept per result ({formatCount(ceiling)}).
        </SettingsCaption>
      )}
    </div>
  )
}

function MaxRowsField() {
  const setPendingChange = useSettingsStore((state) => state.setPendingChange)
  const validateSetting = useSettingsStore((state) => state.validateSetting)
  const maxRowsError = useSettingsStore(
    (state) => state.validationErrors['results.maxRows'] ?? null
  )
  const maxRows = useSettingValue('results.maxRows')

  return (
    <div>
      <SettingsFieldLabel htmlFor="settings-max-rows">
        Maximum rows kept per result
      </SettingsFieldLabel>
      <TextInput
        id="settings-max-rows"
        type="number"
        min={RESULTS_MAX_ROWS_MIN}
        max={RESULTS_MAX_ROWS_MAX}
        value={maxRows}
        invalid={maxRowsError !== null}
        aria-invalid={maxRowsError !== null}
        aria-describedby={
          maxRowsError !== null
            ? 'settings-max-rows-help settings-max-rows-error'
            : 'settings-max-rows-help'
        }
        onChange={(event) => setPendingChange('results.maxRows', event.target.value)}
        onBlur={() => validateSetting('results.maxRows')}
        data-testid="settings-max-rows"
        fieldWidth="narrow"
      />
      <SettingsCaption id="settings-max-rows-help">
        Upper bound for any result, including queries with their own LIMIT or CALL. Results that
        reach it are marked truncated. Applies to queries run after you save.
      </SettingsCaption>
      {maxRowsError !== null && (
        <SettingsCaption
          id="settings-max-rows-error"
          tone="error"
          data-testid="settings-max-rows-error"
        >
          {maxRowsError}
        </SettingsCaption>
      )}
    </div>
  )
}

function DataGridSection() {
  const setPendingChange = useSettingsStore((state) => state.setPendingChange)
  const nullDisplay = useSettingValue('results.nullDisplay')

  return (
    <SettingsSection title="Data grid" description="Customize how query results are displayed.">
      <RowLimitField />
      <MaxRowsField />
      <div>
        <SettingsFieldLabel htmlFor="settings-null-display">NULL display text</SettingsFieldLabel>
        <TextInput
          id="settings-null-display"
          value={nullDisplay}
          onChange={(event) => setPendingChange('results.nullDisplay', event.target.value)}
          data-testid="settings-null-display"
          fieldWidth="medium"
        />
      </div>
    </SettingsSection>
  )
}

function ResultCacheSection() {
  const setPendingChange = useSettingsStore((state) => state.setPendingChange)
  const cacheTTL = useSettingValue('results.cacheTTL')

  return (
    <SettingsSection
      title="Result cache"
      description="Control how long query results and table data are kept in memory before being discarded."
    >
      <div>
        <SettingsFieldLabel id="cache-ttl-label">Cache duration</SettingsFieldLabel>
        <div className="w-50">
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
  )
}

function WorkspaceLayoutSection() {
  const setPendingChange = useSettingsStore((state) => state.setPendingChange)
  const tableTabsInBottomPanel = useSettingValue('results.tableTabsInBottomPanel')
  const maxTabsPerGroup = useSettingValue('results.maxTabsPerGroup')

  return (
    <SettingsSection
      title="Workspace layout"
      description="Configure where table browsing tabs appear and how many tabs each group keeps open."
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
      <div>
        <SettingsFieldLabel id="max-tabs-per-group-label">
          Max open tabs per group
        </SettingsFieldLabel>
        <div className="w-50">
          <Dropdown
            id="settings-max-tabs-per-group"
            labelledBy="max-tabs-per-group-label"
            options={MAX_TABS_PER_GROUP_OPTIONS}
            value={maxTabsPerGroup}
            onChange={(value) => setPendingChange('results.maxTabsPerGroup', value)}
            data-testid="settings-max-tabs-per-group"
          />
        </div>
        <SettingsCaption>
          Opening a tab past the limit closes the least recently used tab in its group. Query tabs
          and tabs with unsaved changes are never closed automatically.
        </SettingsCaption>
      </div>
    </SettingsSection>
  )
}

export function ResultsSettings() {
  return (
    <div data-testid="settings-results">
      <DataGridSection />
      <ResultCacheSection />
      <WorkspaceLayoutSection />
    </div>
  )
}
