import { SpinnerGap } from '@phosphor-icons/react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { Textarea } from '../common/Textarea'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import type { TableDesignerProperties } from '../../types/schema'
import styles from './TablePropertiesEditor.module.css'
import {
  ENGINE_DROPDOWN_OPTIONS,
  ROW_FORMAT_DROPDOWN_OPTIONS,
  autoIncrementInputValue,
  collationOf,
  parseAutoIncrement,
  resolveSelectedCharset,
} from './table-properties-editor/table-properties-model'
import {
  useCharsetOptions,
  useCollationOptions,
} from './table-properties-editor/use-property-options'
import { FIELD_CHROME } from '../../lib/class-names-field'

interface TablePropertiesEditorProps {
  tabId: string
  connectionId: string
  databaseName: string
}

interface PropertyOptions {
  options: DropdownOption[]
  isLoading: boolean
}

type PropertyChange = <TField extends keyof TableDesignerProperties>(
  field: TField,
  value: TableDesignerProperties[TField]
) => void

function LabelSpinner({ isLoading }: { isLoading: boolean }) {
  if (!isLoading) return null
  return <SpinnerGap size={12} className={styles.spinner} aria-hidden />
}

interface PropertyDropdownFieldProps {
  tabId: string
  field: string
  label: string
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  isLoading?: boolean
  disabled?: boolean
}

function PropertyDropdownField(field: PropertyDropdownFieldProps) {
  const labelId = `table-properties-${field.field}-label-${field.tabId}`
  const hasLoadingState = field.isLoading !== undefined
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} id={labelId}>
        {hasLoadingState ? <span>{field.label}</span> : field.label}
        {hasLoadingState && <LabelSpinner isLoading={field.isLoading === true} />}
      </label>
      <Dropdown
        id={`table-properties-${field.field}-${field.tabId}`}
        labelledBy={labelId}
        options={field.options}
        value={field.value}
        disabled={field.disabled}
        data-testid={`table-properties-${field.field}`}
        onChange={field.onChange}
        workspaceTabId={field.tabId}
        triggerClassName={styles.control}
      />
    </div>
  )
}

interface PropertyFieldsProps {
  tabId: string
  properties: TableDesignerProperties
  onChange: PropertyChange
}

function AutoIncrementField({ tabId, properties, onChange }: PropertyFieldsProps) {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor={`table-properties-auto-increment-${tabId}`}>
        Auto increment
      </label>
      <TextInput
        id={`table-properties-auto-increment-${tabId}`}
        variant="bare"
        type="number"
        min="1"
        className={`${FIELD_CHROME} ${styles.control}`}
        value={autoIncrementInputValue(properties)}
        data-testid="table-properties-auto-increment"
        onChange={(event) => onChange('autoIncrement', parseAutoIncrement(event.target.value))}
      />
    </div>
  )
}

function CommentField({ tabId, properties, onChange }: PropertyFieldsProps) {
  return (
    <div className={`${styles.fieldGroup} ${styles.fullWidth}`}>
      <label className={styles.label} htmlFor={`table-properties-comment-${tabId}`}>
        Comment
      </label>
      <Textarea
        id={`table-properties-comment-${tabId}`}
        variant="bare"
        className={`${FIELD_CHROME} ${styles.control} ${styles.textarea}`}
        value={properties.comment}
        data-testid="table-properties-comment"
        onChange={(event) => onChange('comment', event.target.value)}
      />
    </div>
  )
}

interface CharsetAndEngineFieldsProps {
  fieldProps: PropertyFieldsProps
  selectedCharset: string
  charsets: PropertyOptions
  collations: PropertyOptions
}

function CharsetAndEngineFields(fields: CharsetAndEngineFieldsProps) {
  const { selectedCharset, charsets, collations } = fields
  const { tabId, properties, onChange: handlePropertyChange } = fields.fieldProps
  return (
    <>
      <PropertyDropdownField
        tabId={tabId}
        field="engine"
        label="Engine"
        options={ENGINE_DROPDOWN_OPTIONS}
        value={properties.engine}
        onChange={(value) => handlePropertyChange('engine', value)}
      />
      <PropertyDropdownField
        tabId={tabId}
        field="charset"
        label="Character set"
        options={charsets.options}
        value={selectedCharset}
        isLoading={charsets.isLoading}
        disabled={charsets.isLoading}
        onChange={(value) => handlePropertyChange('charset', value)}
      />
      <PropertyDropdownField
        tabId={tabId}
        field="collation"
        label="Collation"
        options={collations.options}
        value={properties.collation}
        isLoading={collations.isLoading}
        disabled={collations.isLoading || !selectedCharset}
        onChange={(value) => handlePropertyChange('collation', value)}
      />
    </>
  )
}

export function TablePropertiesEditor({ tabId, connectionId }: TablePropertiesEditorProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const updateProperties = useTableDesignerStore((state) => state.updateProperties)
  const properties = tabState?.currentSchema.properties
  const currentCollation = collationOf(properties)
  const selectedCharset = resolveSelectedCharset(properties)
  const charsets = useCharsetOptions(connectionId, selectedCharset)
  const collations = useCollationOptions({
    tabId: tabId,
    connectionId: connectionId,
    selectedCharset: selectedCharset,
    currentCollation: currentCollation,
    updateProperties: updateProperties,
  })

  if (!properties) {
    return null
  }

  const handlePropertyChange: PropertyChange = (field, value) => {
    updateProperties(tabId, field, value)
  }
  const fieldProps = { tabId: tabId, properties: properties, onChange: handlePropertyChange }

  return (
    <div className={styles.container} data-testid="table-properties-editor">
      <div className={styles.grid}>
        <div className={styles.column}>
          <CharsetAndEngineFields
            fieldProps={fieldProps}
            selectedCharset={selectedCharset}
            charsets={charsets}
            collations={collations}
          />
          <AutoIncrementField {...fieldProps} />
        </div>

        <div className={styles.column}>
          <PropertyDropdownField
            tabId={tabId}
            field="row-format"
            label="Row format"
            options={ROW_FORMAT_DROPDOWN_OPTIONS}
            value={properties.rowFormat}
            onChange={(value) => handlePropertyChange('rowFormat', value)}
          />
        </div>

        <CommentField {...fieldProps} />
      </div>
    </div>
  )
}
