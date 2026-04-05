/**
 * DDL templates for creating new database objects in the object editor.
 * Pure frontend utility — no IPC calls.
 */

import type { EditableObjectType } from '../../types/schema'

export function getObjectTemplate(objectType: EditableObjectType, databaseName: string): string {
  switch (objectType) {
    case 'procedure':
      return [
        `CREATE PROCEDURE \`${databaseName}\`.\`procedure_name\`(`,
        `  IN p_param1 INT`,
        `)`,
        `BEGIN`,
        `  -- Procedure body`,
        `  SELECT p_param1;`,
        `END`,
      ].join('\n')

    case 'function':
      return [
        `CREATE FUNCTION \`${databaseName}\`.\`function_name\`(`,
        `  p_param1 INT`,
        `) RETURNS INT`,
        `DETERMINISTIC`,
        `BEGIN`,
        `  -- Function body`,
        `  RETURN p_param1;`,
        `END`,
      ].join('\n')

    case 'trigger':
      return [
        `CREATE TRIGGER \`${databaseName}\`.\`trigger_name\``,
        `BEFORE INSERT ON \`<table_name>\``,
        `FOR EACH ROW`,
        `BEGIN`,
        `  -- Trigger body`,
        `END`,
      ].join('\n')

    case 'event':
      return [
        `CREATE EVENT \`${databaseName}\`.\`event_name\``,
        `ON SCHEDULE EVERY 1 DAY`,
        `DO`,
        `BEGIN`,
        `  -- Event body`,
        `END`,
      ].join('\n')

    case 'view':
      return [`CREATE VIEW \`${databaseName}\`.\`view_name\` AS`, `SELECT 1`].join('\n')
  }
}
