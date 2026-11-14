import type { BuiltinSignatureEntry } from './signature-types'

export const GALERA_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'WSREP_LAST_SEEN_GTID',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns the last GTID seen in the write-set replication stream (Galera).',
    },
  ],
  [
    'WSREP_LAST_WRITTEN_GTID',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns the last GTID written in the write-set replication stream (Galera).',
    },
  ],
  [
    'WSREP_SYNC_WAIT_UPTO_GTID',
    {
      parameters: [{ label: 'gtid' }],
      returnType: 'INT',
      documentation:
        'Waits until the node has applied all transactions up to the given GTID (Galera).',
    },
  ],
]
