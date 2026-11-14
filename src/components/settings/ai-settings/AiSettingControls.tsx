import type { ReactNode } from 'react'
import { Button } from '../../common/Button'
import { TextInput } from '../../common/TextInput'
import { ConfirmDialog } from '../../dialogs/ConfirmDialog'
import { SettingsToggle } from '../SettingsToggle'
import { useSettingValue } from '../../../stores/settings-store'
import type { ConnectionIndexState } from '../../../stores/schema-index-store'
import {
  describeBuildingState,
  forceReindexAllSessions,
  setPendingSetting,
  type NumericSettingFieldConfig,
} from './ai-settings-model'
import { useBuildingConnections } from './use-ai-model-fetch'
import styles from '../AiSettings.module.css'

const ENDPOINT_INPUT_WIDTH_PX = 360

interface ReindexRowProps {
  buildingConnections: ConnectionIndexState[]
  onRequestReindex: () => void
}

export function ReindexRow({ buildingConnections, onRequestReindex }: ReindexRowProps) {
  const isBuilding = buildingConnections.length > 0
  return (
    <div className={styles.reindexRow} data-testid="ai-reindex-row">
      <Button onClick={onRequestReindex} disabled={isBuilding} data-testid="ai-force-reindex-btn">
        {isBuilding ? 'Reindexing...' : 'Force reindex'}
      </Button>
      {isBuilding && (
        <span
          className={styles.reindexStatus}
          data-testid="ai-reindex-status"
          role="status"
          aria-live="polite"
        >
          {describeBuildingState(buildingConnections)}
        </span>
      )}
    </div>
  )
}

interface NumericSettingFieldProps {
  field: NumericSettingFieldConfig
  disabled: boolean
}

function NumericSettingField({ field, disabled }: NumericSettingFieldProps) {
  const value = useSettingValue(field.settingKey)
  return (
    <div className={styles.compactField}>
      <label htmlFor={field.id} className={styles.fieldLabel}>
        {field.label}
      </label>
      <TextInput
        id={field.id}
        type="number"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={(event) => setPendingSetting(field.settingKey, event.target.value)}
        disabled={disabled}
        data-testid={field.testId}
        className={styles.compactFieldInput}
      />
    </div>
  )
}

interface NumericSettingGridProps {
  fields: NumericSettingFieldConfig[]
  disabled: boolean
}

export function NumericSettingGrid({ fields, disabled }: NumericSettingGridProps) {
  return (
    <div className={styles.compactFieldGrid}>
      {fields.map((field) => (
        <NumericSettingField key={field.settingKey} field={field} disabled={disabled} />
      ))}
    </div>
  )
}

interface SettingSwitchProps {
  settingKey: string
  label: string
  description: string
  isChecked: (value: string) => boolean
  disabled?: boolean
  testId: string
}

export function SettingSwitch({
  settingKey,
  label,
  description,
  isChecked,
  disabled,
  testId,
}: SettingSwitchProps) {
  const value = useSettingValue(settingKey)
  return (
    <SettingsToggle
      label={label}
      description={description}
      checked={isChecked(value)}
      onChange={(checked) => setPendingSetting(settingKey, String(checked))}
      disabled={disabled}
      data-testid={testId}
    />
  )
}

interface EndpointFieldProps {
  settingKey: string
  id: string
  label: string
  placeholder: string
  disabled: boolean
  children?: ReactNode
}

export function EndpointField({
  settingKey,
  id,
  label,
  placeholder,
  disabled,
  children,
}: EndpointFieldProps) {
  const value = useSettingValue(settingKey)
  return (
    <div>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <TextInput
        id={id}
        value={value}
        onChange={(event) => setPendingSetting(settingKey, event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        data-testid={id}
        style={{ width: ENDPOINT_INPUT_WIDTH_PX }}
      />
      {children}
    </div>
  )
}

interface ForceReindexDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function ForceReindexDialog({ isOpen, onClose }: ForceReindexDialogProps) {
  const isBuilding = useBuildingConnections().length > 0
  const confirmReindex = () => {
    forceReindexAllSessions().finally(onClose)
  }
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title="Force reindex vector DB"
      message="This will wipe the current schema index and rebuild it from scratch for all active connections. This may take a few minutes."
      confirmLabel="Reindex"
      isDestructive
      warningText={null}
      isLoading={isBuilding}
      onConfirm={confirmReindex}
      onCancel={onClose}
    />
  )
}
