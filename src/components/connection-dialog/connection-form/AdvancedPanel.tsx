import { TextInput } from '../../common/TextInput'
import { Dropdown } from '../../common/Dropdown'
import { ColorPickerPopover } from '../ColorPickerPopover'
import {
  DEFAULT_CONNECT_TIMEOUT_SECONDS,
  DEFAULT_KEEPALIVE_INTERVAL_SECONDS,
} from '../connection-editor-state'
import { FormField, type FormFields } from './form-fields'
import {
  CONNECTION_FIELD_GROUP,
  CONNECTION_FIELD_LABEL,
  CONNECTION_TAB_PANEL,
} from '../../../lib/class-names-connection-form'

const DECIMAL_RADIX = 10
const MAX_CONNECT_TIMEOUT_SECONDS = 300
const MAX_KEEPALIVE_INTERVAL_SECONDS = 3600

const ACCESS_MODE_OPTIONS = [
  { value: 'rw', label: 'Allow writes (read-write)' },
  { value: 'ro', label: 'Read-only (block writes)' },
]

interface AdvancedPanelProps {
  fields: FormFields
  groupDropdownOptions: { value: string; label: string }[]
}

function GroupAndAccessRow({ fields, groupDropdownOptions }: AdvancedPanelProps) {
  return (
    <div className="grid grid-cols-2 items-start gap-x-3 gap-y-3.5 max-compact:grid-cols-1">
      <div className={CONNECTION_FIELD_GROUP}>
        <label id="conn-group-label" htmlFor="conn-group" className={CONNECTION_FIELD_LABEL}>
          Group
        </label>
        <Dropdown
          id="conn-group"
          labelledBy="conn-group-label"
          listAriaLabel="Group"
          options={groupDropdownOptions}
          value={fields.formData.groupId ?? ''}
          onChange={(value) => fields.updateField('groupId', value || null)}
        />
      </div>
      <div className={CONNECTION_FIELD_GROUP}>
        <label id="conn-access-label" htmlFor="conn-access" className={CONNECTION_FIELD_LABEL}>
          Access mode
        </label>
        <Dropdown
          id="conn-access"
          labelledBy="conn-access-label"
          options={ACCESS_MODE_OPTIONS}
          value={fields.formData.readOnly ? 'ro' : 'rw'}
          onChange={(value) => fields.updateField('readOnly', value === 'ro')}
        />
      </div>
    </div>
  )
}

function TabColorField({ fields }: { fields: FormFields }) {
  return (
    <div className={CONNECTION_FIELD_GROUP}>
      <span className={CONNECTION_FIELD_LABEL}>Tab color</span>
      <div className="flex min-h-10 items-center gap-2">
        <ColorPickerPopover
          color={fields.formData.color}
          onChange={(color) => fields.updateField('color', color)}
        />
        <span className="font-mono text-size-body text-light-on-surface-variant dark:text-dark-on-surface-variant">
          {fields.formData.color ?? 'No color set'}
        </span>
      </div>
    </div>
  )
}

interface SecondsFieldSpec {
  id: string
  label: string
  field: 'connectTimeoutSecs' | 'keepaliveIntervalSecs'
  fallback: number
  min: number
  max: number
}

const TIMEOUT_FIELDS: SecondsFieldSpec[] = [
  {
    id: 'connect-timeout',
    label: 'Connect timeout',
    field: 'connectTimeoutSecs',
    fallback: DEFAULT_CONNECT_TIMEOUT_SECONDS,
    min: 1,
    max: MAX_CONNECT_TIMEOUT_SECONDS,
  },
  {
    id: 'keepalive',
    label: 'Keepalive interval',
    field: 'keepaliveIntervalSecs',
    fallback: DEFAULT_KEEPALIVE_INTERVAL_SECONDS,
    min: 0,
    max: MAX_KEEPALIVE_INTERVAL_SECONDS,
  },
]

function SecondsField({ fields, spec }: { fields: FormFields; spec: SecondsFieldSpec }) {
  return (
    <FormField id={spec.id} label={spec.label} error={fields.errors[spec.field]}>
      <div className="flex items-center gap-2">
        <TextInput
          id={spec.id}
          type="number"
          variant="mono"
          className="max-w-30"
          invalid={!!fields.errors[spec.field]}
          value={fields.formData[spec.field]}
          onChange={(event) =>
            fields.updateField(
              spec.field,
              parseInt(event.target.value, DECIMAL_RADIX) || spec.fallback
            )
          }
          min={spec.min}
          max={spec.max}
        />
        <span className="font-body text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
          seconds
        </span>
      </div>
    </FormField>
  )
}

export function AdvancedPanel({ fields, groupDropdownOptions }: AdvancedPanelProps) {
  return (
    <div
      className={CONNECTION_TAB_PANEL}
      role="tabpanel"
      data-testid="connection-form-panel-advanced"
    >
      <GroupAndAccessRow fields={fields} groupDropdownOptions={groupDropdownOptions} />
      <TabColorField fields={fields} />
      <div className="grid grid-cols-2 items-start gap-x-3 gap-y-3.5 max-compact:grid-cols-1">
        {TIMEOUT_FIELDS.map((spec) => (
          <SecondsField key={spec.id} fields={fields} spec={spec} />
        ))}
      </div>
    </div>
  )
}
