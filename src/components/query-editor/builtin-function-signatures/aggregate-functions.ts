import type { BuiltinSignatureEntry } from './signature-types'

export const AGGREGATE_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'AVG',
    {
      parameters: [{ label: 'expr', documentation: 'The numeric expression to average.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the average value of expr.',
    },
  ],
  [
    'BIT_AND',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'BIGINT',
      documentation: 'Returns the bitwise AND of all bits in expr.',
    },
  ],
  [
    'BIT_OR',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'BIGINT',
      documentation: 'Returns the bitwise OR of all bits in expr.',
    },
  ],
  [
    'BIT_XOR',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'BIGINT',
      documentation: 'Returns the bitwise XOR of all bits in expr.',
    },
  ],
  [
    'COUNT',
    {
      parameters: [
        {
          label: 'expr',
          documentation: 'The expression to count. Use * to count all rows.',
        },
      ],
      returnType: 'BIGINT',
      documentation:
        'Returns a count of the number of non-NULL values. Also: COUNT(*), COUNT(DISTINCT expr)',
    },
  ],
  [
    'GROUP_CONCAT',
    {
      parameters: [
        {
          label: 'expr',
          documentation: 'The expression to concatenate. Supports ORDER BY and SEPARATOR.',
        },
      ],
      returnType: 'TEXT',
      documentation: 'Returns a string result with the concatenated non-NULL values from a group.',
    },
  ],
  [
    'JSON_ARRAYAGG',
    {
      parameters: [
        { label: 'col_or_expr', documentation: 'The value to aggregate into a JSON array.' },
      ],
      returnType: 'JSON',
      documentation: 'Aggregates a result set as a single JSON array.',
    },
  ],
  [
    'JSON_OBJECTAGG',
    {
      parameters: [
        { label: 'key', documentation: 'The key expression.' },
        { label: 'value', documentation: 'The value expression.' },
      ],
      returnType: 'JSON',
      documentation: 'Aggregates a result set as a single JSON object.',
    },
  ],
  [
    'MAX',
    {
      parameters: [{ label: 'expr', documentation: 'The expression to find minimum/maximum of.' }],
      returnType: 'mixed',
      documentation: 'Returns the maximum value of expr.',
    },
  ],
  [
    'MEDIAN',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the median value of expr within a group (MariaDB).',
    },
  ],
  [
    'MIN',
    {
      parameters: [{ label: 'expr', documentation: 'The expression to find minimum/maximum of.' }],
      returnType: 'mixed',
      documentation: 'Returns the minimum value of expr.',
    },
  ],
  [
    'STD',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the population standard deviation of expr.',
    },
  ],
  [
    'STDDEV',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the population standard deviation of expr. Synonym for STD().',
    },
  ],
  [
    'STDDEV_POP',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the population standard deviation of expr.',
    },
  ],
  [
    'STDDEV_SAMP',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the sample standard deviation of expr.',
    },
  ],
  [
    'SUM',
    {
      parameters: [{ label: 'expr', documentation: 'The numeric expression to sum.' }],
      returnType: 'NUMERIC',
      documentation: 'Returns the sum of expr.',
    },
  ],
  [
    'VAR_POP',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the population standard variance of expr.',
    },
  ],
  [
    'VAR_SAMP',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the sample variance of expr.',
    },
  ],
  [
    'VARIANCE',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the population standard variance of expr.',
    },
  ],
]
