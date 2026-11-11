import type { SchemaIndexStatus, SearchResult } from '../../lib/schema-index-commands'

export const SCHEMA_INDEX_STATUS: SchemaIndexStatus = { status: 'ready' }

export const SEMANTIC_SEARCH_RESULTS: SearchResult[] = [
  {
    chunkId: 1,
    chunkKey: 'table:ecommerce_db.users',
    dbName: 'ecommerce_db',
    tableName: 'users',
    chunkType: 'table',
    ddlText:
      'CREATE TABLE `ecommerce_db`.`users` (`id` int NOT NULL, `name` varchar(255), `email` varchar(255), PRIMARY KEY (`id`)) -- approximate rows: 15000\n-- Table comment: Registered platform users',
    refDbName: null,
    refTableName: null,
    score: 0.95,
  },
]
