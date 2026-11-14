import type { BuiltinSignatureEntry } from './signature-types'

export const MISC_UTILITY_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'BIT_COUNT',
    {
      parameters: [{ label: 'N' }],
      returnType: 'BIGINT',
      documentation: 'Returns the number of bits that are set in the argument N.',
    },
  ],
  [
    'CONVERT_TZ',
    {
      parameters: [{ label: 'dt' }, { label: 'from_tz' }, { label: 'to_tz' }],
      returnType: 'DATETIME',
      documentation: 'Converts a datetime value dt from time zone from_tz to to_tz.',
    },
  ],
  [
    'SLEEP',
    {
      parameters: [{ label: 'duration' }],
      returnType: 'INT',
      documentation: 'Sleeps (pauses) for the number of seconds given by duration.',
    },
  ],
  [
    'TO_NUMBER',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'NUMERIC',
      documentation: 'Converts a string to a numeric value (MariaDB/Oracle mode).',
    },
  ],
]
