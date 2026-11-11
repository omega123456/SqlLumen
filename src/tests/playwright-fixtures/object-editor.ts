import type { RoutineParameter, SaveObjectResponse } from '../../types/schema'
import type { PlaywrightRoutineParametersResponse } from './types'

export const OBJECT_BODY_BY_TYPE: Record<string, string> = {
  procedure:
    'CREATE PROCEDURE `test_db`.`mock_proc`(\n  IN p_id INT\n)\nBEGIN\n  SELECT p_id;\nEND',
  function:
    'CREATE FUNCTION `test_db`.`mock_func`(\n  p_input INT\n) RETURNS INT\nDETERMINISTIC\nBEGIN\n  RETURN p_input;\nEND',
  trigger:
    'CREATE TRIGGER `test_db`.`mock_trigger`\nBEFORE INSERT ON `mock_table`\nFOR EACH ROW\nBEGIN\n  SET NEW.created_at = NOW();\nEND',
  event:
    'CREATE EVENT `test_db`.`mock_event`\nON SCHEDULE EVERY 1 DAY\nDO BEGIN\n  -- Event body\nEND',
  view: 'CREATE OR REPLACE VIEW `test_db`.`mock_view` AS\nSELECT id, name FROM users',
}

export const DEFAULT_OBJECT_BODY = 'CREATE ...'

export const FUNCTION_ROUTINE_PARAMETERS_WITH_RETURN_TYPE: PlaywrightRoutineParametersResponse = {
  parameters: [
    { name: '', dataType: 'int', mode: '', ordinalPosition: 0 },
    { name: 'p_id', dataType: 'int', mode: 'IN', ordinalPosition: 1 },
    { name: 'p_result', dataType: 'varchar(255)', mode: 'OUT', ordinalPosition: 2 },
  ],
  found: true,
}

export const DEFAULT_ROUTINE_PARAMETERS_WITH_RETURN_TYPE: PlaywrightRoutineParametersResponse = {
  parameters: [
    { name: 'p_id', dataType: 'int', mode: 'IN', ordinalPosition: 1 },
    { name: 'p_result', dataType: 'varchar(255)', mode: 'OUT', ordinalPosition: 2 },
  ],
  found: true,
}

export const ROUTINE_PARAMETERS: RoutineParameter[] =
  DEFAULT_ROUTINE_PARAMETERS_WITH_RETURN_TYPE.parameters

export const SAVED_OBJECT_RESPONSE: SaveObjectResponse = {
  success: true,
  errorMessage: null,
  dropSucceeded: true,
  savedObjectName: 'mock_object',
}

export const OPENED_SQL_FILE_CONTENT = "SELECT * FROM users\nWHERE status = 'active'\nLIMIT 100;"
