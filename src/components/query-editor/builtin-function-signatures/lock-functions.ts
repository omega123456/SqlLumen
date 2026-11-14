import type { BuiltinSignatureEntry } from './signature-types'

export const LOCK_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'GET_LOCK',
    {
      parameters: [{ label: 'str' }, { label: 'timeout' }],
      returnType: 'INT',
      documentation: 'Tries to obtain a lock with name str, using a timeout of timeout seconds.',
    },
  ],
  [
    'IS_FREE_LOCK',
    {
      parameters: [{ label: 'str' }],
      returnType: 'INT',
      documentation: 'Checks whether the lock named str is free to use.',
    },
  ],
  [
    'IS_USED_LOCK',
    {
      parameters: [{ label: 'str' }],
      returnType: 'BIGINT',
      documentation:
        'Returns the connection ID of the client that holds the lock named str, or NULL.',
    },
  ],
  [
    'RELEASE_LOCK',
    {
      parameters: [{ label: 'str' }],
      returnType: 'INT',
      documentation: 'Releases the lock named str that was obtained with GET_LOCK().',
    },
  ],
]
