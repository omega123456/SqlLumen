import type { BuiltinSignatureEntry } from './signature-types'

export const CONTROL_FLOW_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'COALESCE',
    {
      parameters: [
        { label: 'value', documentation: 'An expression. The first non-NULL value is returned.' },
        { label: '...' },
      ],
      returnType: 'mixed',
      documentation: 'Returns the first non-NULL value in the list.',
    },
  ],
  [
    'IF',
    {
      parameters: [
        { label: 'expr1', documentation: 'The boolean expression.' },
        { label: 'expr2', documentation: 'Value returned when condition is true.' },
        { label: 'expr3', documentation: 'Value returned when condition is false.' },
      ],
      returnType: 'mixed',
      documentation: 'If expr1 is TRUE, returns expr2; otherwise returns expr3.',
    },
  ],
  [
    'IFNULL',
    {
      parameters: [
        { label: 'expr1', documentation: 'The expression to test for NULL.' },
        { label: 'expr2', documentation: 'The value returned if expr is NULL.' },
      ],
      returnType: 'mixed',
      documentation: 'If expr1 is not NULL, returns expr1; otherwise returns expr2.',
    },
  ],
  [
    'NULLIF',
    {
      parameters: [
        { label: 'expr1', documentation: 'The first expression.' },
        { label: 'expr2', documentation: 'If equal to expr1, NULL is returned.' },
      ],
      returnType: 'mixed',
      documentation: 'Returns NULL if expr1 = expr2, otherwise returns expr1.',
    },
  ],
  [
    'INTERVAL',
    {
      parameters: [{ label: 'N' }, { label: 'N1' }, { label: 'N2' }, { label: '...' }],
      returnType: 'INT',
      documentation: 'Returns 0 if N < N1, 1 if N < N2, etc. Returns -1 if N is NULL.',
    },
  ],
]
