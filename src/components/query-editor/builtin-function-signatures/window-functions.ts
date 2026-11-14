import type { BuiltinSignatureEntry } from './signature-types'

export const WINDOW_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'CUME_DIST',
    {
      parameters: [],
      returnType: 'DOUBLE',
      documentation:
        'Returns the cumulative distribution of a value within a group of values (window function).',
    },
  ],
  [
    'DENSE_RANK',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation: 'Returns the rank of the current row without gaps (window function).',
    },
  ],
  [
    'FIRST_VALUE',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'mixed',
      documentation:
        'Returns the value of expr from the first row of the window frame (window function).',
    },
  ],
  [
    'LAG',
    {
      parameters: [{ label: 'expr' }, { label: 'N' }, { label: 'default' }],
      returnType: 'mixed',
      documentation:
        'Returns the value of expr from N rows before the current row (window function).',
    },
  ],
  [
    'LAST_VALUE',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'mixed',
      documentation:
        'Returns the value of expr from the last row of the window frame (window function).',
    },
  ],
  [
    'LEAD',
    {
      parameters: [{ label: 'expr' }, { label: 'N' }, { label: 'default' }],
      returnType: 'mixed',
      documentation:
        'Returns the value of expr from N rows after the current row (window function).',
    },
  ],
  [
    'NTH_VALUE',
    {
      parameters: [{ label: 'expr' }, { label: 'N' }],
      returnType: 'mixed',
      documentation:
        'Returns the value of expr from the Nth row of the window frame (window function).',
    },
  ],
  [
    'NTILE',
    {
      parameters: [{ label: 'N' }],
      returnType: 'BIGINT',
      documentation:
        'Divides the partition into N groups and returns the group number of the current row (window function).',
    },
  ],
  [
    'PERCENT_RANK',
    {
      parameters: [],
      returnType: 'DOUBLE',
      documentation: 'Returns the percentage rank of the current row (window function).',
    },
  ],
  [
    'PERCENTILE_CONT',
    {
      parameters: [{ label: 'percentile' }],
      returnType: 'DOUBLE',
      documentation: 'Continuous percentile within a group (window function).',
    },
  ],
  [
    'PERCENTILE_DISC',
    {
      parameters: [{ label: 'percentile' }],
      returnType: 'mixed',
      documentation: 'Discrete percentile within a group (window function).',
    },
  ],
  [
    'RANK',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation: 'Returns the rank of the current row with gaps (window function).',
    },
  ],
  [
    'ROW_NUMBER',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation:
        'Returns the number of the current row within its partition, starting at 1 (window function).',
    },
  ],
]
