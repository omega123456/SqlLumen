import { describe, it, expect } from 'vitest'
import { buildExecuteTemplate } from '../../lib/execute-template-builder'
import type { RoutineParameter } from '../../types/schema'

describe('buildExecuteTemplate', () => {
  // ---------------------------------------------------------------------------
  // Procedure tests
  // ---------------------------------------------------------------------------

  it('builds CALL template for procedure with IN, OUT, INOUT parameters', () => {
    const params: RoutineParameter[] = [
      { name: 'p_id', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
      { name: 'p_name', dataType: 'VARCHAR(255)', mode: 'IN', ordinalPosition: 2 },
      { name: 'p_count', dataType: 'INT', mode: 'OUT', ordinalPosition: 3 },
      { name: 'p_total', dataType: 'DECIMAL(10,2)', mode: 'INOUT', ordinalPosition: 4 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'mydb',
      routineName: 'my_proc',
      routineType: 'procedure',
      parameters: params,
    })

    expect(result).toBe(
      'CALL `mydb`.`my_proc`(\n' +
        '  /* IN p_id int */ NULL,\n' +
        '  /* IN p_name varchar(255) */ NULL,\n' +
        '  /* OUT p_count int */ @p_count,\n' +
        '  /* INOUT p_total decimal(10,2) */ @p_total\n' +
        ');'
    )
  })

  it('builds CALL template for procedure with no parameters', () => {
    const result = buildExecuteTemplate({
      databaseName: 'mydb',
      routineName: 'no_params',
      routineType: 'procedure',
      parameters: [],
    })

    expect(result).toBe('CALL `mydb`.`no_params`();')
  })

  // ---------------------------------------------------------------------------
  // Function tests
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
})
