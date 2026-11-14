import type { BuiltinSignatureEntry } from './signature-types'

export const REPLICATION_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'BINLOG_GTID_POS',
    {
      parameters: [{ label: 'binlog_filename' }, { label: 'binlog_offset' }],
      returnType: 'VARCHAR',
      documentation:
        'Returns the GTID position corresponding to the given binary log file and offset (MariaDB).',
    },
  ],
  [
    'MASTER_GTID_WAIT',
    {
      parameters: [{ label: 'gtid_list' }],
      returnType: 'INT',
      documentation: 'Waits until the server has applied all GTIDs in the given list (MariaDB).',
    },
  ],
  [
    'MASTER_POS_WAIT',
    {
      parameters: [{ label: 'log_name' }, { label: 'log_pos' }],
      returnType: 'INT',
      documentation:
        'Blocks until the replica has applied all updates to the specified binary log position.',
    },
  ],
]
