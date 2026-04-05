import type { RoutineParameter } from '../types/schema'

/**
 * Build a SQL template for executing a stored procedure or function.
 *
 * - Procedures use `CALL`, functions use `SELECT`.
 * - IN parameters get `NULL` as a placeholder value.
 * - OUT parameters get `@param_name` (user variable).
 * - INOUT parameters get `@param_name` (user variable).
 * - Function parameters (no mode) get `NULL` as a placeholder value.
 * - dataType is lowercased in the comment.
 * - Parameters are sorted by ordinalPosition.
 */
export function buildExecuteTemplate(
  databaseName: string,
  routineName: string,
  routineType: 'procedure' | 'function',
  parameters: RoutineParameter[]
): string {
  const keyword = routineType === 'procedure' ? 'CALL' : 'SELECT'
  const qualifiedName = `\`${databaseName}\`.\`${routineName}\``

  if (parameters.length === 0) {
    return `${keyword} ${qualifiedName}();`
  }

  // Sort by ordinal position
  const sorted = [...parameters].sort((a, b) => a.ordinalPosition - b.ordinalPosition)

  const paramLines = sorted.map((param) => {
    const dataTypeLower = param.dataType.toLowerCase()
    const mode = param.mode.toUpperCase()

    if (routineType === 'function' || mode === '') {
      // Function params have no mode prefix
      return `  /* ${param.name} ${dataTypeLower} */ NULL`
    }

    if (mode === 'OUT') {
      return `  /* OUT ${param.name} ${dataTypeLower} */ @${param.name}`
    }

    if (mode === 'INOUT') {
      return `  /* INOUT ${param.name} ${dataTypeLower} */ @${param.name}`
    }

    // IN (default)
    return `  /* IN ${param.name} ${dataTypeLower} */ NULL`
  })

  return `${keyword} ${qualifiedName}(\n${paramLines.join(',\n')}\n);`
}
