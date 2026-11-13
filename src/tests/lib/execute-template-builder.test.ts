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

  it('OUT parameters use @param_name (not NULL)', () => {
    const params: RoutineParameter[] = [
      { name: 'p_result', dataType: 'INT', mode: 'OUT', ordinalPosition: 1 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'testdb',
      routineName: 'sp_get',
      routineType: 'procedure',
      parameters: params,
    })

    expect(result).toContain('@p_result')
    expect(result).not.toContain('NULL')
  })

  it('INOUT parameters use @param_name (not NULL)', () => {
    const params: RoutineParameter[] = [
      { name: 'p_counter', dataType: 'BIGINT', mode: 'INOUT', ordinalPosition: 1 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'testdb',
      routineName: 'sp_inc',
      routineType: 'procedure',
      parameters: params,
    })

    expect(result).toContain('@p_counter')
    expect(result).not.toContain('NULL')
  })

  it('IN parameters use NULL placeholder', () => {
    const params: RoutineParameter[] = [
      { name: 'p_input', dataType: 'VARCHAR(100)', mode: 'IN', ordinalPosition: 1 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'testdb',
      routineName: 'sp_test',
      routineType: 'procedure',
      parameters: params,
    })

    expect(result).toContain('NULL')
    expect(result).not.toContain('@p_input')
  })

  it('lowercases dataType in comments', () => {
    const params: RoutineParameter[] = [
      { name: 'p_id', dataType: 'BIGINT', mode: 'IN', ordinalPosition: 1 },
      { name: 'p_name', dataType: 'VARCHAR(255)', mode: 'IN', ordinalPosition: 2 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'db',
      routineName: 'proc',
      routineType: 'procedure',
      parameters: params,
    })

    expect(result).toContain('bigint')
    expect(result).toContain('varchar(255)')
    expect(result).not.toContain('BIGINT')
    expect(result).not.toContain('VARCHAR(255)')
  })

  it('sorts parameters by ordinalPosition', () => {
    const params: RoutineParameter[] = [
      { name: 'p_third', dataType: 'INT', mode: 'IN', ordinalPosition: 3 },
      { name: 'p_first', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
      { name: 'p_second', dataType: 'INT', mode: 'IN', ordinalPosition: 2 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'db',
      routineName: 'proc',
      routineType: 'procedure',
      parameters: params,
    })

    const lines = result.split('\n')
    expect(lines[1]).toContain('p_first')
    expect(lines[2]).toContain('p_second')
    expect(lines[3]).toContain('p_third')
  })

  it('backtick-quotes database and routine names', () => {
    const result = buildExecuteTemplate({
      databaseName: 'my-db',
      routineName: 'my-proc',
      routineType: 'procedure',
      parameters: [],
    })

    expect(result).toBe('CALL `my-db`.`my-proc`();')
  })

  // ---------------------------------------------------------------------------
  // Function tests
  // ---------------------------------------------------------------------------

  it('builds SELECT template for function with parameters', () => {
    const params: RoutineParameter[] = [
      { name: 'p_input', dataType: 'VARCHAR(100)', mode: '', ordinalPosition: 1 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'mydb',
      routineName: 'my_func',
      routineType: 'function',
      parameters: params,
    })

    expect(result).toBe('SELECT `mydb`.`my_func`(\n' + '  /* p_input varchar(100) */ NULL\n' + ');')
  })

  it('builds SELECT template for function with no parameters', () => {
    const result = buildExecuteTemplate({
      databaseName: 'mydb',
      routineName: 'no_params_func',
      routineType: 'function',
      parameters: [],
    })

    expect(result).toBe('SELECT `mydb`.`no_params_func`();')
  })

  it('function parameters have no mode prefix in comments', () => {
    const params: RoutineParameter[] = [
      { name: 'p_a', dataType: 'INT', mode: '', ordinalPosition: 1 },
      { name: 'p_b', dataType: 'INT', mode: '', ordinalPosition: 2 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'db',
      routineName: 'func',
      routineType: 'function',
      parameters: params,
    })

    // Should NOT contain IN/OUT/INOUT mode prefixes
    expect(result).not.toMatch(/\/\* (IN|OUT|INOUT) /)
    expect(result).toContain('/* p_a int */ NULL')
    expect(result).toContain('/* p_b int */ NULL')
  })

  it('function parameters always use NULL (even if mode is non-empty)', () => {
    // Functions technically shouldn't have OUT/INOUT, but if mode is set,
    // the template builder should still treat function params without mode prefix
    const params: RoutineParameter[] = [
      { name: 'p_val', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'db',
      routineName: 'func',
      routineType: 'function',
      parameters: params,
    })

    // Function template overrides — no mode prefix, just name+type
    expect(result).toContain('/* p_val int */ NULL')
    expect(result).not.toContain('/* IN p_val')
  })

  it('function parameters sorted by ordinalPosition', () => {
    const params: RoutineParameter[] = [
      { name: 'p_z', dataType: 'INT', mode: '', ordinalPosition: 2 },
      { name: 'p_a', dataType: 'INT', mode: '', ordinalPosition: 1 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'db',
      routineName: 'func',
      routineType: 'function',
      parameters: params,
    })

    const lines = result.split('\n')
    expect(lines[1]).toContain('p_a')
    expect(lines[2]).toContain('p_z')
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it('handles parameters with empty mode as no-mode (defaults to NULL)', () => {
    const params: RoutineParameter[] = [
      { name: 'p_val', dataType: 'TEXT', mode: '', ordinalPosition: 1 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'db',
      routineName: 'proc',
      routineType: 'procedure',
      parameters: params,
    })

    // Empty mode → no prefix, defaults to NULL
    expect(result).toContain('/* p_val text */ NULL')
  })

  it('handles single IN parameter for procedure', () => {
    const params: RoutineParameter[] = [
      { name: 'p_id', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'db',
      routineName: 'sp',
      routineType: 'procedure',
      parameters: params,
    })

    expect(result).toBe('CALL `db`.`sp`(\n  /* IN p_id int */ NULL\n);')
  })

  it('handles mixed OUT and INOUT for procedure', () => {
    const params: RoutineParameter[] = [
      { name: 'p_in', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
      { name: 'p_out', dataType: 'VARCHAR(50)', mode: 'OUT', ordinalPosition: 2 },
      { name: 'p_inout', dataType: 'DECIMAL(5,2)', mode: 'INOUT', ordinalPosition: 3 },
    ]

    const result = buildExecuteTemplate({
      databaseName: 'app',
      routineName: 'sp_mixed',
      routineType: 'procedure',
      parameters: params,
    })

    expect(result).toBe(
      'CALL `app`.`sp_mixed`(\n' +
        '  /* IN p_in int */ NULL,\n' +
        '  /* OUT p_out varchar(50) */ @p_out,\n' +
        '  /* INOUT p_inout decimal(5,2) */ @p_inout\n' +
        ');'
    )
  })

  it('does not mutate the input parameters array', () => {
    const params: RoutineParameter[] = [
      { name: 'b', dataType: 'INT', mode: 'IN', ordinalPosition: 2 },
      { name: 'a', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
    ]

    // Copy for comparison
    const originalOrder = params.map((p) => p.name)

    buildExecuteTemplate({
      databaseName: 'db',
      routineName: 'proc',
      routineType: 'procedure',
      parameters: params,
    })

    // Original array should not be reordered
    expect(params.map((p) => p.name)).toEqual(originalOrder)
  })
})
