import type { BuiltinSignatureEntry } from './signature-types'

export const SPIDER_ENGINE_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'SPIDER_BG_DIRECT_SQL',
    {
      parameters: [{ label: 'sql' }, { label: 'conn_id' }, { label: 'link_id' }],
      returnType: 'INT',
      documentation: 'Executes SQL on a remote Spider node in the background.',
    },
  ],
  [
    'SPIDER_COPY_TABLES',
    {
      parameters: [{ label: 'table_name' }, { label: 'src' }, { label: 'dst' }],
      returnType: 'INT',
      documentation: 'Copies Spider table data from one node to another.',
    },
  ],
  [
    'SPIDER_DIRECT_SQL',
    {
      parameters: [{ label: 'sql' }, { label: 'conn_id' }, { label: 'link_id' }],
      returnType: 'INT',
      documentation: 'Executes SQL directly on a remote Spider node.',
    },
  ],
  [
    'SPIDER_FLUSH_TABLE_MON_CACHE',
    {
      parameters: [],
      returnType: 'INT',
      documentation: 'Flushes the Spider table monitoring cache.',
    },
  ],
]
