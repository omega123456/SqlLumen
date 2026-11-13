import { MYSQL_IDENTIFIER_MAX_LENGTH } from '../../lib/sql-utils'
import type { TableDesignerColumnDef, TableDesignerIndexDef } from '../../types/schema'

export type ValidationErrors = Record<string, string>

function columnNameError(name: string, seenNames: Set<string>): string | null {
  if (!name) return 'Column name is required'
  if (name.length > MYSQL_IDENTIFIER_MAX_LENGTH) {
    return `Column name must not exceed ${MYSQL_IDENTIFIER_MAX_LENGTH} characters`
  }
  if (seenNames.has(name.toLowerCase())) return 'Duplicate column name'
  return null
}

function validateColumns(columns: TableDesignerColumnDef[]): ValidationErrors {
  const errors: ValidationErrors = {}
  const names = new Set<string>()

  columns.forEach((column, columnIndex) => {
    const nameError = columnNameError(column.name, names)
    if (nameError) {
      errors[`columns.${columnIndex}.name`] = nameError
      return
    }
    names.add(column.name.toLowerCase())
  })

  return errors
}

function validateIndexes(indexes: TableDesignerIndexDef[]): ValidationErrors {
  const errors: ValidationErrors = {}
  const names = new Map<string, number[]>()

  indexes.forEach((index, position) => {
    if (index.indexType === 'PRIMARY') {
      return
    }

    const normalizedName = index.name.trim().toLowerCase()
    if (normalizedName !== '') {
      const existing = names.get(normalizedName) ?? []
      existing.push(position)
      names.set(normalizedName, existing)
    }

    const hasNoColumns = index.columns.length === 0
    if (hasNoColumns) {
      errors[`indexes.${position}.columns`] = 'At least one column required'
    }
  })

  names.forEach((indexesForName) => {
    if (indexesForName.length > 1) {
      indexesForName.forEach((indexPosition) => {
        errors[`indexes.${indexPosition}.name`] = 'Duplicate index name'
      })
    }
  })

  return errors
}

function errorsOutsidePrefix(existingErrors: ValidationErrors, prefix: string): ValidationErrors {
  return Object.fromEntries(
    Object.entries(existingErrors).filter(([path]) => !path.startsWith(prefix))
  )
}

function mergeColumnValidationErrors(
  existingErrors: ValidationErrors,
  columns: TableDesignerColumnDef[]
): ValidationErrors {
  return {
    ...errorsOutsidePrefix(existingErrors, 'columns.'),
    ...validateColumns(columns),
  }
}

export function mergeIndexValidationErrors(
  existingErrors: ValidationErrors,
  indexes: TableDesignerIndexDef[]
): ValidationErrors {
  return {
    ...errorsOutsidePrefix(existingErrors, 'indexes.'),
    ...validateIndexes(indexes),
  }
}

export function mergeColumnAndIndexValidationErrors(
  existingErrors: ValidationErrors,
  schema: { columns: TableDesignerColumnDef[]; indexes: TableDesignerIndexDef[] }
): ValidationErrors {
  return mergeIndexValidationErrors(
    mergeColumnValidationErrors(existingErrors, schema.columns),
    schema.indexes
  )
}

export function mergeTableNameValidationError(
  existingErrors: ValidationErrors,
  name: string
): ValidationErrors {
  const nextErrors = Object.fromEntries(
    Object.entries(existingErrors).filter(([path]) => path !== 'tableName')
  )

  if (!name) {
    nextErrors.tableName = 'Table name is required'
  }

  return nextErrors
}
