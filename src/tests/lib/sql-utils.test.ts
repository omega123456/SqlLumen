import { describe, it, expect } from 'vitest'
import { stripLeadingSqlComments, getFirstSqlKeyword } from '../../lib/sql-utils'

describe('stripLeadingSqlComments', () => {
  it('returns SQL unchanged when there are no leading comments', () => {
    expect(stripLeadingSqlComments('SELECT 1')).toBe('SELECT 1')
  })

  it('strips a single block comment', () => {
    expect(stripLeadingSqlComments('/* comment */ SELECT 1')).toBe('SELECT 1')
  })
})

describe('getFirstSqlKeyword', () => {
  it('returns SELECT for a simple select', () => {
    expect(getFirstSqlKeyword('SELECT * FROM t')).toBe('SELECT')
  })

  it('extracts keyword from executable comment after stripping standard comments', () => {
    expect(getFirstSqlKeyword('/* standard */ /*!50001 CALL my_proc() */')).toBe('CALL')
  })
})
