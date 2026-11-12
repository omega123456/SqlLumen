import type { ForeignKeyColumnInfo, ForeignKeyInfo } from '../types/schema'

export function mapSingleColumnForeignKeys(
  foreignKeys: ForeignKeyInfo[] | null | undefined
): ForeignKeyColumnInfo[] {
  if (!foreignKeys || foreignKeys.length === 0) return []

  const mapped = foreignKeys.map((foreignKey) => ({
    columnName: foreignKey.columnName,
    referencedDatabase: foreignKey.referencedDatabase,
    referencedTable: foreignKey.referencedTable,
    referencedColumn: foreignKey.referencedColumn,
    constraintName: foreignKey.name,
  }))

  const countByConstraint = new Map<string, number>()
  for (const foreignKey of mapped) {
    countByConstraint.set(
      foreignKey.constraintName,
      (countByConstraint.get(foreignKey.constraintName) ?? 0) + 1
    )
  }

  return mapped.filter((foreignKey) => (countByConstraint.get(foreignKey.constraintName) ?? 0) <= 1)
}

export function buildForeignKeyLookup(
  foreignKeys: ForeignKeyColumnInfo[] | null | undefined
): Map<string, ForeignKeyColumnInfo> {
  const lookup = new Map<string, ForeignKeyColumnInfo>()
  if (!foreignKeys) return lookup

  for (const foreignKey of foreignKeys) {
    lookup.set(foreignKey.columnName.toLowerCase(), foreignKey)
  }

  return lookup
}
