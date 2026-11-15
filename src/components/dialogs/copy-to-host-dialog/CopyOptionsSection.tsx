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
import { joinClassNames } from '../../../lib/class-names'
import {
  DIALOG_CHECKBOX_LABEL,
  DIALOG_SECTION_FIELD_GROUP,
  DIALOG_SECTION_FIELD_LABEL,
} from '../../../lib/class-names-dialog'

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

type OptionGroupState = 'active' | 'dimmed'

const OPTION_GROUP_STATE_CLASSES: Record<OptionGroupState, string> = {
  active: '',
  dimmed: 'opacity-45',
}

function dimmedWhen(isDimmed: boolean): string {
  const state: OptionGroupState = isDimmed ? 'dimmed' : 'active'
  return joinClassNames([
    'flex flex-col gap-2 transition-opacity',
    OPTION_GROUP_STATE_CLASSES[state],
  ])
}

type OptionRowRisk = 'safe' | 'risky'

const OPTION_ROW_RISK_CLASSES: Record<OptionRowRisk, string> = {
  safe: '',
  risky: 'border-l-2 border-light-warning pl-2 dark:border-dark-warning',
}

function optionRowClassName(isRisky: boolean | undefined): string {
  const risk: OptionRowRisk = isRisky ? 'risky' : 'safe'
  return joinClassNames(['flex items-center gap-2', OPTION_ROW_RISK_CLASSES[risk]])
}

function OptionCheckbox({ id, optionKey, label, section, disabled, isRisky }: OptionCheckboxProps) {
  return (
    <div className={optionRowClassName(isRisky)}>
      {isRisky && (
        <Warning
          size={14}
          weight="fill"
          className="shrink-0 text-light-warning dark:text-dark-warning"
        />
      )}
      <Checkbox
        id={id}
        checked={section.options[optionKey]}
        disabled={disabled}
        onChange={(event) => section.onOptionChange(optionKey, event.target.checked)}
        data-testid={id}
      />
      <label htmlFor={id} className={DIALOG_CHECKBOX_LABEL}>
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
      <span className={DIALOG_SECTION_FIELD_LABEL}>Structure</span>
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
        <p
          className="font-body text-size-caption italic text-light-on-surface-variant dark:text-dark-on-surface-variant wrap-break-word"
          data-testid="copy-structure-na"
        >
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
      <span className={DIALOG_SECTION_FIELD_LABEL}>Data</span>
      <div className={DIALOG_SECTION_FIELD_GROUP}>
        <label className={DIALOG_SECTION_FIELD_LABEL} id="copy-insert-mode-label">
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
        <p
          className="font-body text-size-caption italic text-light-on-surface-variant dark:text-dark-on-surface-variant wrap-break-word"
          data-testid="copy-data-na"
        >
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
      <div className={DIALOG_SECTION_FIELD_GROUP}>
        <label className={DIALOG_SECTION_FIELD_LABEL} id="copy-type-label">
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
      <div
        className="my-3 h-0 border-t border-light-stroke-divider dark:border-dark-stroke-divider"
        role="separator"
      />
      <DataOptions {...section} />
      <div
        className="my-3 h-0 border-t border-light-stroke-divider dark:border-dark-stroke-divider"
        role="separator"
      />
      <OptionCheckbox
        id="copy-ignore-definer"
        optionKey="ignoreDefiner"
        label="Ignore Definer (strip DEFINER from routines/triggers/events)"
        section={section}
      />
    </Section>
  )
}
