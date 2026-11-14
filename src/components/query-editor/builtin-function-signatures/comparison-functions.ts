import type { BuiltinSignatureEntry } from './signature-types'

export const COMPARISON_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'GREATEST',
    {
      parameters: [
        { label: 'value1', documentation: 'A comparable value.' },
        { label: 'value2', documentation: 'A comparable value.' },
        { label: '...' },
      ],
      returnType: 'mixed',
      documentation: 'Returns the largest (maximum-valued) argument.',
    },
  ],
  [
    'ISNULL',
    {
      parameters: [{ label: 'expr', documentation: 'The expression to test.' }],
      returnType: 'INT',
      documentation: 'Returns 1 if expr is NULL, 0 otherwise.',
    },
  ],
  [
    'LEAST',
    {
      parameters: [
        { label: 'value1', documentation: 'A comparable value.' },
        { label: 'value2', documentation: 'A comparable value.' },
        { label: '...' },
      ],
      returnType: 'mixed',
      documentation: 'Returns the smallest (minimum-valued) argument.',
    },
  ],
]
