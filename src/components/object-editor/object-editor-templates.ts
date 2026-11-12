/**
 * DDL templates for creating new database objects in the object editor.
 * Pure frontend utility — no IPC calls.
 */

import type { EditableObjectType } from '../../types/schema'

type ObjectTemplateBuilder = (databaseName: string) => string[]

const OBJECT_TEMPLATE_LINES: Record<EditableObjectType, ObjectTemplateBuilder> = {
  procedure: (databaseName) => [
    `CREATE PROCEDURE \`${databaseName}\`.\`procedure_name\`(`,
    `  IN p_param1 INT`,
    `)`,
    `BEGIN`,
    `  -- Procedure body`,
    `  SELECT p_param1;`,
    `END`,
  ],
  function: (databaseName) => [
    `CREATE FUNCTION \`${databaseName}\`.\`function_name\`(`,
    `  p_param1 INT`,
    `) RETURNS INT`,
    `DETERMINISTIC`,
    `BEGIN`,
    `  -- Function body`,
    `  RETURN p_param1;`,
    `END`,
  ],
  trigger: (databaseName) => [
    `CREATE TRIGGER \`${databaseName}\`.\`trigger_name\``,
    `BEFORE INSERT ON \`<table_name>\``,
    `FOR EACH ROW`,
    `BEGIN`,
    `  -- Trigger body`,
    `END`,
  ],
  event: (databaseName) => [
    `CREATE EVENT \`${databaseName}\`.\`event_name\``,
    `ON SCHEDULE EVERY 1 DAY`,
    `DO`,
    `BEGIN`,
    `  -- Event body`,
    `END`,
  ],
  view: (databaseName) => [`CREATE VIEW \`${databaseName}\`.\`view_name\` AS`, `SELECT 1`],
}

export function getObjectTemplate(objectType: EditableObjectType, databaseName: string): string {
  return OBJECT_TEMPLATE_LINES[objectType](databaseName).join('\n')
}
