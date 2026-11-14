import type { BuiltinSignatureEntry } from './signature-types'

export const VECTOR_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'VEC_DISTANCE',
    {
      parameters: [{ label: 'vec1' }, { label: 'vec2' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the distance between two vectors (MariaDB 11.6+).',
    },
  ],
  [
    'VEC_DISTANCE_COSINE',
    {
      parameters: [{ label: 'vec1' }, { label: 'vec2' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the cosine distance between two vectors (MariaDB 11.6+).',
    },
  ],
  [
    'VEC_DISTANCE_EUCLIDEAN',
    {
      parameters: [{ label: 'vec1' }, { label: 'vec2' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the Euclidean distance between two vectors (MariaDB 11.6+).',
    },
  ],
  [
    'VEC_FROMTEXT',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARBINARY',
      documentation: 'Converts a text representation of a vector to binary format (MariaDB 11.6+).',
    },
  ],
  [
    'VEC_TOTEXT',
    {
      parameters: [{ label: 'vec' }],
      returnType: 'VARCHAR',
      documentation: 'Converts a binary vector to its text representation (MariaDB 11.6+).',
    },
  ],
]
