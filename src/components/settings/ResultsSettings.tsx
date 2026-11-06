import { Dropdown } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { SettingsSection } from './SettingsSection'
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

const LABEL_STYLE = { display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' } as const

/** The existing caption style (`--type-caption-size`, `--on-surface-variant`, 6px top margin). */
const CAPTION_STYLE = {
  margin: '6px 0 0',
  fontSize: 'var(--type-caption-size)',
  lineHeight: 'var(--type-caption-line)',
  color: 'var(--on-surface-variant)',
} as const

const ERROR_CAPTION_STYLE = { ...CAPTION_STYLE, color: 'var(--error)' } as const

/** The effective row ceiling for the cross-field caption, or null when invalid. */
function parseMaxRows(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const parsed = Number(value.trim())
  return parsed >= RESULTS_MAX_ROWS_MIN && parsed <= RESULTS_MAX_ROWS_MAX ? parsed : null
}

export function ResultsSettings() {
  const setPendingChange = useSettingsStore((s) => s.setPendingChange)
  const validateSetting = useSettingsStore((s) => s.validateSetting)
  const maxRowsError = useSettingsStore((s) => s.validationErrors['results.maxRows'] ?? null)

  const rowLimit = useSettingValue('results.pageSize')
  const maxRows = useSettingValue('results.maxRows')
  const ceiling = parseMaxRows(maxRows)
  const rowLimitValue = Number(rowLimit)
  const rowLimitExceedsCeiling =
    ceiling !== null && Number.isFinite(rowLimitValue) && rowLimitValue > ceiling
  const nullDisplay = useSettingValue('results.nullDisplay')
  const tableTabsInBottomPanel = useSettingValue('results.tableTabsInBottomPanel')
  const cacheTTL = useSettingValue('results.cacheTTL')
  const maxTabsPerGroup = useSettingValue('results.maxTabsPerGroup')

  return (
    <div data-testid="settings-results">
      <SettingsSection title="Data grid" description="Customize how query results are displayed.">
        <div>
          <label htmlFor="settings-page-size" style={LABEL_STYLE}>
            Row limit
          </label>
          <TextInput
            id="settings-page-size"
            type="number"
            min={10}
            max={10000}
            value={rowLimit}
            onChange={(e) => setPendingChange('results.pageSize', e.target.value)}
            aria-describedby="settings-page-size-help"
            data-testid="settings-page-size"
            style={{ width: 120 }}
          />
          <p id="settings-page-size-help" style={CAPTION_STYLE}>
            Adds a LIMIT to SELECT queries that don't have one. Capped by the maximum below.
          </p>
          {rowLimitExceedsCeiling && (
            <p style={CAPTION_STYLE} data-testid="settings-page-size-capped">
              Limited to the maximum rows kept per result ({formatCount(ceiling)}).
            </p>
          )}
        </div>
        <div>
          <label htmlFor="settings-max-rows" style={LABEL_STYLE}>
            Maximum rows kept per result
          </label>
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
            onChange={(e) => setPendingChange('results.maxRows', e.target.value)}
            onBlur={() => validateSetting('results.maxRows')}
            data-testid="settings-max-rows"
            style={{ width: 120 }}
          />
          <p id="settings-max-rows-help" style={CAPTION_STYLE}>
            Upper bound for any result, including queries with their own LIMIT or CALL. Results that
            reach it are marked truncated. Applies to queries run after you save.
          </p>
          {maxRowsError !== null && (
            <p
              id="settings-max-rows-error"
              style={ERROR_CAPTION_STYLE}
              data-testid="settings-max-rows-error"
            >
              {maxRowsError}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="settings-null-display" style={LABEL_STYLE}>
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
        title="Result cache"
        description="Control how long query results and table data are kept in memory before being discarded."
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
          <label
            id="max-tabs-per-group-label"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            Max open tabs per group
          </label>
          <div style={{ width: 200 }}>
            <Dropdown
              id="settings-max-tabs-per-group"
              labelledBy="max-tabs-per-group-label"
              options={MAX_TABS_PER_GROUP_OPTIONS}
              value={maxTabsPerGroup}
              onChange={(value) => setPendingChange('results.maxTabsPerGroup', value)}
              data-testid="settings-max-tabs-per-group"
            />
          </div>
          <p style={CAPTION_STYLE}>
            Opening a tab past the limit closes the least recently used tab in its group. Query tabs
            and tabs with unsaved changes are never closed automatically.
          </p>
        </div>
      </SettingsSection>
    </div>
  )
}
