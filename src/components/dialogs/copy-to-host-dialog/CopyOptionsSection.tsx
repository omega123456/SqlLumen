import { Warning } from '@phosphor-icons/react'
import { Checkbox } from '../../common/Checkbox'
import { Dropdown } from '../../common/Dropdown'
import {
  COPY_TYPE_OPTIONS,
  INSERT_MODE_OPTIONS,
  type CopyDialogOptions,
  type UpdateCopyOption,
} from './copy-to-host-model'
import { Section } from './CopySection'
import styles from '../CopyToHostDialog.module.css'

interface CopyOptionsSectionProps {
  options: CopyDialogOptions
  onOptionChange: UpdateCopyOption
}

type BooleanOptionKey =
  'dropIfExists' | 'createIfNotExists' | 'truncateBeforeInsert' | 'ignoreDefiner'

interface OptionCheckboxProps {
  id: string
  optionKey: BooleanOptionKey
  label: string
  section: CopyOptionsSectionProps
  disabled?: boolean
  isRisky?: boolean
}

function dimmedWhen(isDimmed: boolean): string {
  if (!isDimmed) return styles.optionGroup
  return `${styles.optionGroup} ${styles.dimmed}`
}

function OptionCheckbox({ id, optionKey, label, section, disabled, isRisky }: OptionCheckboxProps) {
  const rowClassName = isRisky
    ? `${styles.checkboxRow} ${styles.warningAccent}`
    : styles.checkboxRow
  return (
    <div className={rowClassName}>
      {isRisky && <Warning size={14} weight="fill" className={styles.warningIcon} />}
      <Checkbox
        id={id}
        checked={section.options[optionKey]}
        disabled={disabled}
        onChange={(event) => section.onOptionChange(optionKey, event.target.checked)}
        data-testid={id}
      />
      <label htmlFor={id} className={styles.checkboxLabel}>
        {label}
      </label>
    </div>
  )
}

function StructureOptions(section: CopyOptionsSectionProps) {
  const structureDisabled = section.options.copyType === 'dataOnly'
  return (
    <div
      className={dimmedWhen(structureDisabled)}
      aria-disabled={structureDisabled}
      data-testid="copy-structure-group"
    >
      <span className={styles.optionGroupLabel}>Structure</span>
      <OptionCheckbox
        id="copy-drop-if-exists"
        optionKey="dropIfExists"
        label="DROP … IF EXISTS first"
        section={section}
        disabled={structureDisabled}
        isRisky
      />
      <OptionCheckbox
        id="copy-create-if-not-exists"
        optionKey="createIfNotExists"
        label="CREATE TABLE IF NOT EXISTS"
        section={section}
        disabled={structureDisabled}
      />
      {structureDisabled && (
        <p className={styles.notApplicable} data-testid="copy-structure-na">
          Not applicable for Data only
        </p>
      )}
    </div>
  )
}

function DataOptions(section: CopyOptionsSectionProps) {
  const { options, onOptionChange } = section
  const dataDisabled = options.copyType === 'structureOnly'
  return (
    <div
      className={dimmedWhen(dataDisabled)}
      aria-disabled={dataDisabled}
      data-testid="copy-data-group"
    >
      <span className={styles.optionGroupLabel}>Data</span>
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} id="copy-insert-mode-label">
          Insert mode
        </label>
        <Dropdown
          id="copy-insert-mode"
          labelledBy="copy-insert-mode-label"
          options={INSERT_MODE_OPTIONS}
          value={options.insertMode}
          disabled={dataDisabled}
          onChange={(value) => onOptionChange('insertMode', value)}
          data-testid="copy-insert-mode"
        />
      </div>
      <OptionCheckbox
        id="copy-truncate"
        optionKey="truncateBeforeInsert"
        label="Truncate target table before insert"
        section={section}
        disabled={dataDisabled}
        isRisky
      />
      {dataDisabled && (
        <p className={styles.notApplicable} data-testid="copy-data-na">
          Not applicable for Structure only
        </p>
      )}
    </div>
  )
}

export function CopyOptionsSection(section: CopyOptionsSectionProps) {
  const { options, onOptionChange } = section
  return (
    <Section title="Options" testId="copy-options-section">
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} id="copy-type-label">
          Copy type
        </label>
        <Dropdown
          id="copy-type"
          labelledBy="copy-type-label"
          options={COPY_TYPE_OPTIONS}
          value={options.copyType}
          onChange={(value) => onOptionChange('copyType', value)}
          data-testid="copy-type"
        />
      </div>
      <StructureOptions {...section} />
      <div className={styles.divider} role="separator" />
      <DataOptions {...section} />
      <div className={styles.divider} role="separator" />
      <OptionCheckbox
        id="copy-ignore-definer"
        optionKey="ignoreDefiner"
        label="Ignore Definer (strip DEFINER from routines/triggers/events)"
        section={section}
      />
    </Section>
  )
}
