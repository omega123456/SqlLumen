import { describe, expect, it } from 'vitest'
import { getGridCellClass, getGridCellKind, type GridCellKind } from '../../lib/grid-cell-classes'

const NUMERIC_TYPES = [
  'INT',
  'INTEGER',
  'TINYINT',
  'SMALLINT',
  'MEDIUMINT',
  'BIGINT',
  'FLOAT',
  'DOUBLE',
  'DECIMAL',
  'NUMERIC',
  'REAL',
  'int(11)',
  'DECIMAL(10,2)',
  'BIGINT UNSIGNED',
]
const TEMPORAL_TYPES = ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'datetime(6)', 'timestamp']
const STRING_TYPES = ['VARCHAR(255)', 'CHAR(10)', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT']
const OTHER_TYPES = ['BLOB', 'BINARY', 'ENUM', 'SET', 'BIT', 'GEOMETRY']
const ALL_KINDS: GridCellKind[] = ['monoMuted', 'mono', 'json', 'primaryText', 'text']

describe('getGridCellKind', () => {
  it.each(NUMERIC_TYPES)('classifies %s as muted monospace', (type) => {
    expect(getGridCellKind('col', type)).toBe('monoMuted')
  })

  it.each(TEMPORAL_TYPES)('classifies %s as monospace', (type) => {
    expect(getGridCellKind('col', type)).toBe('mono')
  })

  it.each(STRING_TYPES)('classifies %s as primary text', (type) => {
    expect(getGridCellKind('col', type)).toBe('primaryText')
  })

  it.each(OTHER_TYPES)('classifies %s as plain text', (type) => {
    expect(getGridCellKind('col', type)).toBe('text')
  })

  it('classifies JSON columns as json', () => {
    expect(getGridCellKind('payload', 'JSON')).toBe('json')
  })

  it('classifies primary key columns as muted monospace whatever their type', () => {
    expect(getGridCellKind('id', 'VARCHAR(255)', ['id'])).toBe('monoMuted')
    expect(getGridCellKind('slug', 'TEXT', ['slug'])).toBe('monoMuted')
  })

  it('ignores primary key names that are missing, empty or for another column', () => {
    expect(getGridCellKind('id', 'VARCHAR(255)')).toBe('primaryText')
    expect(getGridCellKind('id', 'VARCHAR(255)', [])).toBe('primaryText')
    expect(getGridCellKind('name', 'VARCHAR(255)', ['id'])).toBe('primaryText')
  })

  it('falls back to plain text for an empty data type', () => {
    expect(getGridCellKind('col', '')).toBe('text')
  })

  it('matches data types case-insensitively', () => {
    expect(getGridCellKind('col', 'varchar(100)')).toBe('primaryText')
    expect(getGridCellKind('col', 'Datetime')).toBe('mono')
    expect(getGridCellKind('col', 'bigint')).toBe('monoMuted')
  })
})

describe('getGridCellClass', () => {
  it('returns a non-empty class for every kind of cell', () => {
    const classes = ALL_KINDS.map((kind) => getGridCellClass('col', sampleTypeOf(kind)))
    expect(classes.every((className) => className.length > 0)).toBe(true)
  })

  it('gives the same class to columns of the same kind', () => {
    expect(getGridCellClass('a', 'INT')).toBe(getGridCellClass('b', 'DOUBLE'))
  })

  it('gives different classes to monospace, primary and plain cells', () => {
    const classes = new Set([
      getGridCellClass('col', 'INT'),
      getGridCellClass('col', 'DATETIME'),
      getGridCellClass('col', 'VARCHAR(10)'),
      getGridCellClass('col', 'BLOB'),
    ])
    expect(classes.size).toBe(4)
  })
})

function sampleTypeOf(kind: GridCellKind): string {
  const sampleTypes: Record<GridCellKind, string> = {
    monoMuted: 'INT',
    mono: 'DATETIME',
    json: 'JSON',
    primaryText: 'VARCHAR(10)',
    text: 'BLOB',
  }
  return sampleTypes[kind]
}
