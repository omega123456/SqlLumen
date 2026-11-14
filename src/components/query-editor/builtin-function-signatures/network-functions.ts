import type { BuiltinSignatureEntry } from './signature-types'

export const NETWORK_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'INET_ATON',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'BIGINT',
      documentation:
        'Given the dotted-quad representation of a network address, returns an integer.',
    },
  ],
  [
    'INET_NTOA',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'VARCHAR',
      documentation: 'Given a numeric IPv4 network address, returns the dotted-quad string.',
    },
  ],
  [
    'INET6_ATON',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'VARBINARY',
      documentation: 'Given an IPv6 or IPv4 address string, returns the binary representation.',
    },
  ],
  [
    'INET6_NTOA',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'VARCHAR',
      documentation: 'Given a binary IPv6 address, returns the string representation.',
    },
  ],
  [
    'IS_IPV4',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the argument is a valid IPv4 address, 0 otherwise.',
    },
  ],
  [
    'IS_IPV4_COMPAT',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the argument is an IPv4-compatible IPv6 address.',
    },
  ],
  [
    'IS_IPV4_MAPPED',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the argument is an IPv4-mapped IPv6 address.',
    },
  ],
  [
    'IS_IPV6',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the argument is a valid IPv6 address, 0 otherwise.',
    },
  ],
]
