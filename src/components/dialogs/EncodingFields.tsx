import { Dropdown, type DropdownOption } from '../common/Dropdown'
import type { UseDatabaseEncodingReturn } from '../../hooks/useDatabaseEncoding'
import type { CharsetInfo, CollationInfo } from '../../types/schema'
import styles from './EncodingFields.module.css'

const SERVER_DEFAULT_CHARSET_OPTION: DropdownOption = { value: '', label: 'Server default' }
const DEFAULT_COLLATION_OPTION: DropdownOption = { value: '', label: 'Default' }
const DEFAULT_COLLATION_DESCRIPTION = 'default'

export interface EncodingFieldsProps {
  idPrefix: string
  encoding: UseDatabaseEncodingReturn
}

function buildCharsetOptions(charsets: CharsetInfo[]): DropdownOption[] {
  const charsetOptions = charsets.map((charsetInfo) => ({
    value: charsetInfo.charset,
    label: charsetInfo.charset,
    description: charsetInfo.description,
  }))
  return [SERVER_DEFAULT_CHARSET_OPTION, ...charsetOptions]
}

function buildCollationOptions(collations: CollationInfo[]): DropdownOption[] {
  const collationOptions = collations.map((collation) => ({
    value: collation.name,
    label: collation.name,
    description: collation.isDefault ? DEFAULT_COLLATION_DESCRIPTION : undefined,
  }))
  return [DEFAULT_COLLATION_OPTION, ...collationOptions]
}

export function EncodingFields({ idPrefix, encoding }: EncodingFieldsProps) {
  const charsetId = `${idPrefix}-charset`
  const collationId = `${idPrefix}-collation`
  return (
    <>
      <div className={styles.formGroup}>
        <label className={styles.label} id={`${charsetId}-label`}>
          Character set
        </label>
        <Dropdown
          id={charsetId}
          labelledBy={`${charsetId}-label`}
          options={buildCharsetOptions(encoding.charsets)}
          value={encoding.charset}
          onChange={encoding.setCharset}
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label} id={`${collationId}-label`}>
          Collation
        </label>
        <Dropdown
          id={collationId}
          labelledBy={`${collationId}-label`}
          options={buildCollationOptions(encoding.filteredCollations)}
          value={encoding.collation}
          onChange={encoding.setCollation}
        />
      </div>
    </>
  )
}
