import type { ForeignKeyColumnInfo, ForeignKeyInfo } from '../types/schema'

export function mapSingleColumnForeignKeys(
  foreignKeys: ForeignKeyInfo[] | null | undefined
): ForeignKeyColumnInfo[] {
  if (!foreignKeys || foreignKeys.length === 0) return []

  const mapped = foreignKeys.map((fk) => ({
    columnName: fk.columnName,
    referencedDatabase: fk.referencedDatabase,
    referencedTable: fk.referencedTable,
    referencedColumn: fk.referencedColumn,
    constraintName: fk.name,
  }))

  const countByConstraint = new Map<string, number>()
  for (const fk of mapped) {
    countByConstraint.set(fk.constraintName, (countByConstraint.get(fk.constraintName) ?? 0) + 1)
  }

  return mapped.filter((fk) => (countByConstraint.get(fk.constraintName) ?? 0) <= 1)
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
