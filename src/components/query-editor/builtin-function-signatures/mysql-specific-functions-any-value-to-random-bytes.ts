import type { BuiltinSignatureEntry } from './signature-types'

export const MYSQL_SPECIFIC_FUNCTION_ANY_VALUE_TO_RANDOM_BYTES_SIGNATURES: readonly BuiltinSignatureEntry[] =
  [
    [
      'ANY_VALUE',
      {
        parameters: [{ label: 'arg' }],
        returnType: 'mixed',
        documentation:
          'Suppresses ONLY_FULL_GROUP_BY rejection of a query; returns an arbitrary value from the group.',
      },
    ],
    [
      'ASYNCHRONOUS_CONNECTION_FAILOVER_ADD_MANAGED',
      {
        parameters: [
          { label: 'channel' },
          { label: 'managed_type' },
          { label: 'managed_name' },
          { label: 'primary_weight' },
          { label: 'secondary_weight' },
        ],
        returnType: 'VARCHAR',
        documentation: 'Adds a managed source to the replication failover source list (MySQL GR).',
      },
    ],
    [
      'ASYNCHRONOUS_CONNECTION_FAILOVER_ADD_SOURCE',
      {
        parameters: [
          { label: 'channel' },
          { label: 'host' },
          { label: 'port' },
          { label: 'network_namespace' },
          { label: 'weight' },
        ],
        returnType: 'VARCHAR',
        documentation: 'Adds a source to the replication failover source list (MySQL).',
      },
    ],
    [
      'ASYNCHRONOUS_CONNECTION_FAILOVER_DELETE_MANAGED',
      {
        parameters: [{ label: 'channel' }, { label: 'managed_name' }],
        returnType: 'VARCHAR',
        documentation:
          'Removes a managed source from the replication failover source list (MySQL GR).',
      },
    ],
    [
      'ASYNCHRONOUS_CONNECTION_FAILOVER_DELETE_SOURCE',
      {
        parameters: [
          { label: 'channel' },
          { label: 'host' },
          { label: 'port' },
          { label: 'network_namespace' },
        ],
        returnType: 'VARCHAR',
        documentation: 'Removes a source from the replication failover source list (MySQL).',
      },
    ],
    [
      'ASYNCHRONOUS_CONNECTION_FAILOVER_RESET',
      {
        parameters: [],
        returnType: 'VARCHAR',
        documentation: 'Resets the asynchronous connection failover feature (MySQL).',
      },
    ],
    [
      'BIN_TO_UUID',
      {
        parameters: [{ label: 'binary_uuid' }],
        returnType: 'VARCHAR',
        documentation: 'Converts a binary UUID to a string UUID.',
      },
    ],
    [
      'GEOMCOLLECTION',
      {
        parameters: [{ label: 'g' }, { label: '...' }],
        returnType: 'GEOMETRYCOLLECTION',
        documentation: 'Constructs a GeometryCollection (MySQL synonym for GEOMETRYCOLLECTION).',
      },
    ],
    [
      'GROUP_REPLICATION_DISABLE_MEMBER_ACTION',
      {
        parameters: [{ label: 'name' }, { label: 'event' }],
        returnType: 'VARCHAR',
        documentation: 'Disables a Group Replication member action (MySQL GR).',
      },
    ],
    [
      'GROUP_REPLICATION_ENABLE_MEMBER_ACTION',
      {
        parameters: [{ label: 'name' }, { label: 'event' }],
        returnType: 'VARCHAR',
        documentation: 'Enables a Group Replication member action (MySQL GR).',
      },
    ],
    [
      'GROUP_REPLICATION_GET_COMMUNICATION_PROTOCOL',
      {
        parameters: [],
        returnType: 'VARCHAR',
        documentation:
          'Returns the communication protocol version used by Group Replication (MySQL GR).',
      },
    ],
    [
      'GROUP_REPLICATION_GET_WRITE_CONCURRENCY',
      {
        parameters: [],
        returnType: 'INT',
        documentation: 'Returns the maximum number of consensus instances in flight (MySQL GR).',
      },
    ],
    [
      'GROUP_REPLICATION_RESET_MEMBER_ACTIONS',
      {
        parameters: [],
        returnType: 'VARCHAR',
        documentation: 'Resets all member actions to their default configuration (MySQL GR).',
      },
    ],
    [
      'GROUP_REPLICATION_SET_AS_PRIMARY',
      {
        parameters: [{ label: 'member_uuid' }],
        returnType: 'VARCHAR',
        documentation:
          'Appoints the group member with the given UUID as the new primary (MySQL GR).',
      },
    ],
    [
      'GROUP_REPLICATION_SET_COMMUNICATION_PROTOCOL',
      {
        parameters: [{ label: 'version' }],
        returnType: 'VARCHAR',
        documentation: 'Sets the communication protocol version for Group Replication (MySQL GR).',
      },
    ],
    [
      'GROUP_REPLICATION_SET_WRITE_CONCURRENCY',
      {
        parameters: [{ label: 'instances' }],
        returnType: 'VARCHAR',
        documentation: 'Sets the maximum number of consensus instances in flight (MySQL GR).',
      },
    ],
    [
      'GROUP_REPLICATION_SWITCH_TO_MULTI_PRIMARY_MODE',
      {
        parameters: [],
        returnType: 'VARCHAR',
        documentation: 'Switches Group Replication to multi-primary mode (MySQL GR).',
      },
    ],
    [
      'GROUP_REPLICATION_SWITCH_TO_SINGLE_PRIMARY_MODE',
      {
        parameters: [],
        returnType: 'VARCHAR',
        documentation: 'Switches Group Replication to single-primary mode (MySQL GR).',
      },
    ],
    [
      'GROUPING',
      {
        parameters: [{ label: 'expr' }],
        returnType: 'INT',
        documentation:
          'Returns 1 when the expression is NULL due to a ROLLUP operation; 0 otherwise.',
      },
    ],
    [
      'ICU_VERSION',
      {
        parameters: [],
        returnType: 'VARCHAR',
        documentation:
          'Returns the version of the ICU library used by MySQL for regular expressions.',
      },
    ],
    [
      'IS_UUID',
      {
        parameters: [{ label: 'string_uuid' }],
        returnType: 'INT',
        documentation: 'Returns 1 if the argument is a valid string-format UUID, 0 if not.',
      },
    ],
    [
      'JSON_SCHEMA_VALIDATION_REPORT',
      {
        parameters: [{ label: 'schema' }, { label: 'document' }],
        returnType: 'JSON',
        documentation: 'Validates a document against a JSON schema and returns a detailed report.',
      },
    ],
    [
      'JSON_STORAGE_FREE',
      {
        parameters: [{ label: 'json_val' }],
        returnType: 'INT',
        documentation:
          'Returns the amount of storage freed in a JSON column after a partial update.',
      },
    ],
    [
      'JSON_STORAGE_SIZE',
      {
        parameters: [{ label: 'json_val' }],
        returnType: 'INT',
        documentation: 'Returns the storage space in bytes used for the binary JSON document.',
      },
    ],
    [
      'MATCH',
      {
        parameters: [{ label: 'col, ...) AGAINST(expr' }],
        returnType: 'DOUBLE',
        documentation:
          'Full-text search. Syntax: MATCH(col1,...) AGAINST(expr [IN BOOLEAN MODE|IN NATURAL LANGUAGE MODE])',
      },
    ],
    [
      'MBRCOVERS',
      {
        label: 'MBRCovers(g1, g2)',
        parameters: [{ label: 'g1' }, { label: 'g2' }],
        returnType: 'INT',
        documentation: 'Returns 1 if the MBR of g1 covers the MBR of g2 (MySQL).',
      },
    ],
    [
      'PS_CURRENT_THREAD_ID',
      {
        parameters: [],
        returnType: 'BIGINT',
        documentation: 'Returns the Performance Schema thread ID for the current thread (MySQL).',
      },
    ],
    [
      'PS_THREAD_ID',
      {
        parameters: [{ label: 'connection_id' }],
        returnType: 'BIGINT',
        documentation:
          'Returns the Performance Schema thread ID for the given connection ID (MySQL).',
      },
    ],
    [
      'RANDOM_BYTES',
      {
        parameters: [{ label: 'len' }],
        returnType: 'VARBINARY',
        documentation:
          'Returns a binary string of len random bytes generated using a random number generator.',
      },
    ],
  ]
