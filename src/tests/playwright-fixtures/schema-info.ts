import type { PlaywrightSchemaInfo } from './types'

export const SCHEMA_INFO_BY_OBJECT_TYPE: Record<string, PlaywrightSchemaInfo> = {
  table: {
    columns: [
      {
        name: 'id',
        dataType: 'bigint',
        nullable: false,
        columnKey: 'PRI',
        defaultValue: null,
        extra: 'auto_increment',
        ordinalPosition: 1,
      },
      {
        name: 'name',
        dataType: 'varchar',
        nullable: false,
        columnKey: '',
        defaultValue: null,
        extra: '',
        ordinalPosition: 2,
      },
      {
        name: 'email',
        dataType: 'varchar',
        nullable: false,
        columnKey: '',
        defaultValue: null,
        extra: '',
        ordinalPosition: 3,
      },
    ],
    indexes: [
      {
        name: 'PRIMARY',
        indexType: 'BTREE',
        cardinality: 1000,
        columns: ['id'],
        isVisible: true,
        isUnique: true,
      },
    ],
    foreignKeys: [],
    ddl: 'CREATE TABLE `users` (\n  `id` bigint NOT NULL AUTO_INCREMENT,\n  `name` varchar(255) NOT NULL,\n  `email` varchar(255) NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    metadata: {
      engine: 'InnoDB',
      collation: 'utf8mb4_general_ci',
      autoIncrement: 1001,
      createTime: '2023-01-15T00:00:00',
      tableRows: 1000,
      dataLength: 1048576,
      indexLength: 524288,
    },
  },
  view: {
    columns: [
      {
        name: 'user_id',
        dataType: 'bigint',
        nullable: false,
        columnKey: '',
        defaultValue: null,
        extra: '',
        ordinalPosition: 1,
      },
      {
        name: 'total',
        dataType: 'bigint',
        nullable: false,
        columnKey: '',
        defaultValue: null,
        extra: '',
        ordinalPosition: 2,
      },
    ],
    indexes: [],
    foreignKeys: [],
    ddl: 'CREATE VIEW `user_stats` AS SELECT user_id, COUNT(*) as total FROM orders GROUP BY user_id',
    metadata: null,
  },
  procedure: {
    columns: [],
    indexes: [],
    foreignKeys: [],
    ddl: 'CREATE PROCEDURE `sp_get_orders`()\nBEGIN\n  SELECT * FROM orders;\nEND',
    metadata: null,
  },
  function: {
    columns: [],
    indexes: [],
    foreignKeys: [],
    ddl: 'CREATE FUNCTION `fn_calculate_total`(order_id BIGINT) RETURNS DECIMAL(10,2)\nBEGIN\n  RETURN 0.00;\nEND',
    metadata: null,
  },
  trigger: {
    columns: [],
    indexes: [],
    foreignKeys: [],
    ddl: "CREATE TRIGGER `trg_before_insert` BEFORE INSERT ON `orders`\nFOR EACH ROW\nBEGIN\n  SET NEW.status = 'pending';\nEND",
    metadata: null,
  },
  event: {
    columns: [],
    indexes: [],
    foreignKeys: [],
    ddl: 'CREATE EVENT `cleanup_job` ON SCHEDULE EVERY 1 DAY DO DELETE FROM logs WHERE created_at < NOW() - INTERVAL 30 DAY',
    metadata: null,
  },
}

export const DEFAULT_SCHEMA_INFO: PlaywrightSchemaInfo = {
  columns: [],
  indexes: [],
  foreignKeys: [],
  ddl: 'CREATE ...',
  metadata: null,
}
