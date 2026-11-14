import { TextInput } from '../../common/TextInput'
import { Dropdown } from '../../common/Dropdown'
import { ColorPickerPopover } from '../ColorPickerPopover'
import {
  DEFAULT_CONNECT_TIMEOUT_SECONDS,
  DEFAULT_KEEPALIVE_INTERVAL_SECONDS,
} from '../connection-editor-state'
import { FormField, type FormFields } from './form-fields'
import styles from '../ConnectionForm.module.css'

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
    <div className={styles.rowEvenSplit}>
      <div className={styles.fieldGroup}>
        <label id="conn-group-label" htmlFor="conn-group" className={styles.labelCaps}>
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
      <div className={styles.fieldGroup}>
        <label id="conn-access-label" htmlFor="conn-access" className={styles.labelCaps}>
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
    <div className={styles.fieldGroup}>
      <span className={styles.labelCaps}>Tab color</span>
      <div className={styles.tabColorRow}>
        <ColorPickerPopover
          color={fields.formData.color}
          onChange={(color) => fields.updateField('color', color)}
        />
        <span className={styles.tabColorValue}>{fields.formData.color ?? 'No color set'}</span>
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
      <div className={styles.numberInputRow}>
        <TextInput
          id={spec.id}
          type="number"
          variant="mono"
          className={styles.numberField}
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
        <span className={styles.unitLabel}>seconds</span>
      </div>
    </FormField>
  )
}

export function AdvancedPanel({ fields, groupDropdownOptions }: AdvancedPanelProps) {
  return (
    <div className={styles.tabPanel} role="tabpanel" data-testid="connection-form-panel-advanced">
      <GroupAndAccessRow fields={fields} groupDropdownOptions={groupDropdownOptions} />
      <TabColorField fields={fields} />
      <div className={styles.rowTimeouts}>
        {TIMEOUT_FIELDS.map((spec) => (
          <SecondsField key={spec.id} fields={fields} spec={spec} />
        ))}
      </div>
    </div>
  )
}
