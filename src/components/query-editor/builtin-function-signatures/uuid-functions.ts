import type { BuiltinSignatureEntry } from './signature-types'

export const UUID_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'SYS_GUID',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns a globally unique identifier (MariaDB/Oracle mode).',
    },
  ],
  [
    'UUID',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation:
        'Returns a Universal Unique Identifier (UUID) generated according to RFC 4122.',
    },
  ],
  [
    'UUID_SHORT',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation: 'Returns a short universal identifier as a 64-bit unsigned integer.',
    },
  ],
  [
    'UUIDV4',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns a version 4 (random) UUID (MariaDB 11.7+).',
    },
  ],
  [
    'UUIDV7',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns a version 7 (timestamp-based) UUID (MariaDB 11.7+).',
    },
  ],
]
