import { SpinnerGap } from '@phosphor-icons/react'
import type { LabelHTMLAttributes } from 'react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { Textarea } from '../common/Textarea'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import type { TableDesignerProperties } from '../../types/schema'
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
import { SCROLLBAR, joinClassNames } from '../../lib/class-names'

interface TablePropertiesEditorProps {
  tabId: string
  connectionId: string
  databaseName: string
}

const FIELD_GROUP = 'flex flex-col gap-2'

const TEXT_CONTROL = 'w-full min-h-10 px-3 py-2.5 font-body text-size-caption'

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
  return (
    <SpinnerGap
      size={12}
      className="animate-spin-850ms text-light-primary window-blurred:animate-spin-850ms-paused dark:text-dark-primary"
      aria-hidden
    />
  )
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

function PropertyLabel(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className="inline-flex items-center gap-1.5 text-size-caption font-semibold text-light-on-surface-variant dark:text-dark-on-surface-variant"
      {...props}
    />
  )
}

function PropertyDropdownField(field: PropertyDropdownFieldProps) {
  const labelId = `table-properties-${field.field}-label-${field.tabId}`
  const hasLoadingState = field.isLoading !== undefined
  return (
    <div className={FIELD_GROUP}>
      <PropertyLabel id={labelId}>
        {hasLoadingState ? <span>{field.label}</span> : field.label}
        {hasLoadingState && <LabelSpinner isLoading={field.isLoading === true} />}
      </PropertyLabel>
      <Dropdown
        id={`table-properties-${field.field}-${field.tabId}`}
        labelledBy={labelId}
        options={field.options}
        value={field.value}
        disabled={field.disabled}
        data-testid={`table-properties-${field.field}`}
        onChange={field.onChange}
        workspaceTabId={field.tabId}
        triggerSize="field"
        waiting={field.disabled}
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
    <div className={FIELD_GROUP}>
      <PropertyLabel htmlFor={`table-properties-auto-increment-${tabId}`}>
        Auto increment
      </PropertyLabel>
      <TextInput
        id={`table-properties-auto-increment-${tabId}`}
        variant="bare"
        type="number"
        min="1"
        className={joinClassNames([FIELD_CHROME, TEXT_CONTROL])}
        value={autoIncrementInputValue(properties)}
        data-testid="table-properties-auto-increment"
        onChange={(event) => onChange('autoIncrement', parseAutoIncrement(event.target.value))}
      />
    </div>
  )
}

function CommentField({ tabId, properties, onChange }: PropertyFieldsProps) {
  return (
    <div className={joinClassNames([FIELD_GROUP, 'col-span-full max-wide:col-auto'])}>
      <PropertyLabel htmlFor={`table-properties-comment-${tabId}`}>Comment</PropertyLabel>
      <Textarea
        id={`table-properties-comment-${tabId}`}
        variant="bare"
        className={joinClassNames([FIELD_CHROME, TEXT_CONTROL, 'min-h-30 resize-y'])}
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
    <div
      className={joinClassNames(['flex min-h-0 flex-1 overflow-y-auto px-5 py-4', SCROLLBAR])}
      data-testid="table-properties-editor"
    >
      <div className="grid w-full grid-cols-2 gap-4 max-wide:grid-cols-1">
        <div className="flex flex-col gap-4">
          <CharsetAndEngineFields
            fieldProps={fieldProps}
            selectedCharset={selectedCharset}
            charsets={charsets}
            collations={collations}
          />
          <AutoIncrementField {...fieldProps} />
        </div>

        <div className="flex flex-col gap-4">
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
