import { describe, expect, it } from 'vitest'
import { filterProcessListRows, isIdleProcessRow } from '../../lib/processlist-filter'
import type { ProcessRow } from '../../lib/processlist-commands'

const rows: ProcessRow[] = [
  {
    id: 1,
    user: 'root',
    host: 'localhost',
    db: 'test',
    command: 'Query',
    time: 0,
    state: 'executing',
    info: 'SELECT 1',
  },
  {
    id: 2,
    user: 'root',
    host: 'localhost',
    db: 'test',
    command: 'Sleep',
    time: 30,
    state: 'Idle',
    info: 'SELECT SLEEP(30)',
  },
  {
    id: 3,
    user: 'root',
    host: 'localhost',
    db: 'test',
    command: 'Sleep',
    time: 10,
    state: 'executing',
    info: null,
  },
]

describe('processlist-filter', () => {
  it('treats idle state as idle regardless of casing', () => {
    expect(isIdleProcessRow(rows[1])).toBe(true)
  })

  it('treats blank query info as idle', () => {
    expect(isIdleProcessRow(rows[2])).toBe(true)
  })

  it('filters idle rows when enabled', () => {
    expect(filterProcessListRows(rows, true).map((row) => row.id)).toEqual([1])
  })

  it('returns all rows when disabled', () => {
    expect(filterProcessListRows(rows, false).map((row) => row.id)).toEqual([1, 2, 3])
  })
})
