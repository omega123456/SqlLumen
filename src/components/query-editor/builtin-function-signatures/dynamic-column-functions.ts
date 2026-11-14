import type { BuiltinSignatureEntry } from './signature-types'

export const DYNAMIC_COLUMN_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'COLUMN_ADD',
    {
      parameters: [
        { label: 'dyncol_blob' },
        { label: 'column_nr' },
        { label: 'value' },
        { label: '...' },
      ],
      returnType: 'VARBINARY',
      documentation: 'Adds or updates dynamic columns in a dynamic columns blob (MariaDB).',
    },
  ],
  [
    'COLUMN_CHECK',
    {
      parameters: [{ label: 'dyncol_blob' }],
      returnType: 'INT',
      documentation: 'Checks whether a dynamic columns blob is valid (MariaDB).',
    },
  ],
  [
    'COLUMN_CREATE',
    {
      parameters: [{ label: 'column_nr' }, { label: 'value' }, { label: '...' }],
      returnType: 'VARBINARY',
      documentation: 'Creates a dynamic columns blob (MariaDB).',
    },
  ],
  [
    'COLUMN_DELETE',
    {
      parameters: [{ label: 'dyncol_blob' }, { label: 'column_nr' }, { label: '...' }],
      returnType: 'VARBINARY',
      documentation: 'Deletes dynamic columns from a dynamic columns blob (MariaDB).',
    },
  ],
  [
    'COLUMN_EXISTS',
    {
      parameters: [{ label: 'dyncol_blob' }, { label: 'column_nr' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the given column exists in the dynamic columns blob (MariaDB).',
    },
  ],
  [
    'COLUMN_GET',
    {
      parameters: [{ label: 'dyncol_blob' }, { label: 'column_nr AS type' }],
      returnType: 'mixed',
      documentation: 'Gets the value of a dynamic column from a blob (MariaDB).',
    },
  ],
  [
    'COLUMN_JSON',
    {
      parameters: [{ label: 'dyncol_blob' }],
      returnType: 'JSON',
      documentation: 'Returns a JSON representation of a dynamic columns blob (MariaDB).',
    },
  ],
  [
    'COLUMN_LIST',
    {
      parameters: [{ label: 'dyncol_blob' }],
      returnType: 'VARCHAR',
      documentation:
        'Returns a comma-separated list of column names from a dynamic columns blob (MariaDB).',
    },
  ],
]
