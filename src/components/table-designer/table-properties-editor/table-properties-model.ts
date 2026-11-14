import type { DropdownOption } from '../../common/Dropdown'
import type { CollationInfo, TableDesignerProperties } from '../../../types/schema'

const ENGINE_OPTIONS = ['InnoDB', 'MyISAM', 'MEMORY', 'ARCHIVE', 'CSV', 'BLACKHOLE'] as const
const ROW_FORMAT_OPTIONS = ['DEFAULT', 'DYNAMIC', 'COMPACT', 'REDUNDANT', 'COMPRESSED'] as const

export const ENGINE_DROPDOWN_OPTIONS: DropdownOption[] = ENGINE_OPTIONS.map((engine) => ({
  value: engine,
  label: engine,
}))

export const ROW_FORMAT_DROPDOWN_OPTIONS: DropdownOption[] = ROW_FORMAT_OPTIONS.map(
  (rowFormat) => ({
    value: rowFormat,
    label: rowFormat,
  })
)

export function deriveCharsetFromCollation(collation: string | null | undefined): string {
  if (!collation) {
    return ''
  }

  const separatorIndex = collation.indexOf('_')
  if (separatorIndex <= 0) {
    return collation
  }

  return collation.slice(0, separatorIndex)
}

function getDefaultCollationForCharset(charset: string, collations: CollationInfo[]): string {
  const defaultCollation = collations.find((collation) => collation.isDefault)?.name
  if (defaultCollation) {
    return defaultCollation
  }

  return collations.find((collation) => collation.charset === charset)?.name ?? ''
}

export function parseAutoIncrement(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (Number.isNaN(parsed)) return null
  if (parsed < 1) return null

  return parsed
}

const DEFAULT_AUTO_INCREMENT = 1

export function collationOf(properties: TableDesignerProperties | undefined): string {
  return properties?.collation ?? ''
}

export function resolveSelectedCharset(properties: TableDesignerProperties | undefined): string {
  if (!properties) return ''
  return properties.charset || deriveCharsetFromCollation(properties.collation)
}

export function autoIncrementInputValue(properties: TableDesignerProperties): string {
  return String(properties.autoIncrement ?? DEFAULT_AUTO_INCREMENT)
}

export interface CharsetOptionsState {
  options: DropdownOption[]
  loadedCount: number
  isLoading: boolean
  selectedCharset: string
}

export function charsetDropdownOptions(state: CharsetOptionsState): DropdownOption[] {
  const isLoadingFirstCharsets = state.isLoading && state.loadedCount === 0
  if (isLoadingFirstCharsets) {
    return [{ value: state.selectedCharset || '', label: 'Loading charsets...', disabled: true }]
  }
  const hasNoCharsets = !state.isLoading && state.options.length === 0
  if (hasNoCharsets) {
    return [{ value: '', label: 'No charsets available', disabled: true }]
  }
  return state.options
}

export interface CollationOptionsState {
  options: DropdownOption[]
  isLoading: boolean
  currentCollation: string
}

export function collationDropdownOptions(state: CollationOptionsState): DropdownOption[] {
  if (state.isLoading) {
    return [{ value: state.currentCollation, label: 'Loading collations...', disabled: true }]
  }
  const hasNoCollations = state.options.length === 0
  if (hasNoCollations) {
    return [{ value: '', label: 'No collations available', disabled: true }]
  }
  return state.options
}

export function collationToSelect(
  collations: CollationInfo[],
  selectedCharset: string,
  currentCollation: string
): string | null {
  const hasSelectedCollation = collations.some((collation) => collation.name === currentCollation)
  if (hasSelectedCollation) return null
  const defaultCollation = getDefaultCollationForCharset(selectedCharset, collations)
  if (!defaultCollation) return null
  if (defaultCollation === currentCollation) return null
  return defaultCollation
}
