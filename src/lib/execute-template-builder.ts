import type { RoutineParameter } from '../types/schema'

export interface ExecuteTemplateInputs {
  databaseName: string
  routineName: string
  routineType: 'procedure' | 'function'
  parameters: RoutineParameter[]
}

export function buildExecuteTemplate({
  databaseName,
  routineName,
  routineType,
  parameters,
}: ExecuteTemplateInputs): string {
  const keyword = routineType === 'procedure' ? 'CALL' : 'SELECT'
  const qualifiedName = `\`${databaseName}\`.\`${routineName}\``

  if (parameters.length === 0) {
    return `${keyword} ${qualifiedName}();`
  }

  const sorted = [...parameters].sort((left, right) => left.ordinalPosition - right.ordinalPosition)

  const paramLines = sorted.map((param) => {
    const dataTypeLower = param.dataType.toLowerCase()
    const mode = param.mode.toUpperCase()

    const hasNoModePrefix = routineType === 'function' || mode === ''
    if (hasNoModePrefix) {
      return `  /* ${param.name} ${dataTypeLower} */ NULL`
    }

    if (mode === 'OUT') {
      return `  /* OUT ${param.name} ${dataTypeLower} */ @${param.name}`
    }

    if (mode === 'INOUT') {
      return `  /* INOUT ${param.name} ${dataTypeLower} */ @${param.name}`
    }

    return `  /* IN ${param.name} ${dataTypeLower} */ NULL`
  })

  return `${keyword} ${qualifiedName}(\n${paramLines.join(',\n')}\n);`
}
