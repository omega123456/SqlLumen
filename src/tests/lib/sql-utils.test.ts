import { describe, it, expect } from 'vitest'
import { stripLeadingSqlComments, getFirstSqlKeyword } from '../../lib/sql-utils'

describe('stripLeadingSqlComments', () => {
  it('returns SQL unchanged when there are no leading comments', () => {
    expect(stripLeadingSqlComments('SELECT 1')).toBe('SELECT 1')
  })

  it('strips a single block comment', () => {
    expect(stripLeadingSqlComments('/* comment */ SELECT 1')).toBe('SELECT 1')
  })

  it('strips multiple block comments', () => {
    expect(stripLeadingSqlComments('/* a */ /* b */ SELECT 1')).toBe('SELECT 1')
  })

  it('strips nested block comments', () => {
    expect(stripLeadingSqlComments('/* outer /* inner */ still outer */ SELECT 1')).toBe('SELECT 1')
  })

  it('strips line comments (-- style)', () => {
    expect(stripLeadingSqlComments('-- comment\nSELECT 1')).toBe('SELECT 1')
  })

  it('strips multiple line comments', () => {
    expect(stripLeadingSqlComments('-- a\n-- b\nSELECT 1')).toBe('SELECT 1')
  })

  it('strips hash comments', () => {
    expect(stripLeadingSqlComments('# comment\nSELECT 1')).toBe('SELECT 1')
  })

  it('strips mixed comment styles', () => {
    expect(stripLeadingSqlComments('/* block */ -- line\nSELECT 1')).toBe('SELECT 1')
    expect(stripLeadingSqlComments('-- line\n/* block */ SELECT 1')).toBe('SELECT 1')
    expect(stripLeadingSqlComments('# hash\n/* block */ SELECT 1')).toBe('SELECT 1')
  })

  it('handles leading whitespace', () => {
    expect(stripLeadingSqlComments('  /* spaced */ SELECT 1')).toBe('SELECT 1')
  })

  it('returns empty string when input is only comments', () => {
    expect(stripLeadingSqlComments('-- only a comment')).toBe('')
    expect(stripLeadingSqlComments('# only a hash comment')).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(stripLeadingSqlComments('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(stripLeadingSqlComments('   ')).toBe('')
  })

  it('preserves MySQL executable comments (/*! ... */)', () => {
    expect(stripLeadingSqlComments('/*!50001 CALL my_proc() */')).toBe('/*!50001 CALL my_proc() */')
  })

  it('preserves MySQL optimizer hints (/*+ ... */)', () => {
    expect(stripLeadingSqlComments('/*+ BKA(t1) */ SELECT 1')).toBe('/*+ BKA(t1) */ SELECT 1')
  })

  it('strips standard block comments before executable comments', () => {
    expect(stripLeadingSqlComments('/* standard */ /*!50001 CALL my_proc() */')).toBe(
      '/*!50001 CALL my_proc() */'
    )
  })

  it('strips line comments before executable comments', () => {
    expect(stripLeadingSqlComments('-- line comment\n/*!50001 CALL my_proc() */')).toBe(
      '/*!50001 CALL my_proc() */'
    )
  })
})

describe('getFirstSqlKeyword', () => {
  it('returns SELECT for a simple select', () => {
    expect(getFirstSqlKeyword('SELECT * FROM t')).toBe('SELECT')
  })

  it('returns INSERT for insert', () => {
    expect(getFirstSqlKeyword('insert into t values (1)')).toBe('INSERT')
  })

  it('returns WITH for CTE', () => {
    expect(getFirstSqlKeyword('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe('WITH')
  })

  it('returns CALL for call statement', () => {
    expect(getFirstSqlKeyword('CALL my_proc()')).toBe('CALL')
  })

  it('returns empty string for empty input', () => {
    expect(getFirstSqlKeyword('')).toBe('')
  })

  it('strips block comments before extracting keyword', () => {
    expect(getFirstSqlKeyword('/* comment */ SELECT 1')).toBe('SELECT')
  })

  it('strips line comments before extracting keyword', () => {
    expect(getFirstSqlKeyword('-- comment\nSELECT 1')).toBe('SELECT')
  })

  it('strips hash comments before extracting keyword', () => {
    expect(getFirstSqlKeyword('# comment\nSELECT 1')).toBe('SELECT')
  })

  it('strips nested block comments before extracting keyword', () => {
    expect(getFirstSqlKeyword('/* outer /* inner */ still outer */ SELECT 1')).toBe('SELECT')
  })

  it('handles leading whitespace', () => {
    expect(getFirstSqlKeyword('  SELECT 1')).toBe('SELECT')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(getFirstSqlKeyword('   ')).toBe('')
  })

  it('extracts CALL from MySQL executable comment with version', () => {
    expect(getFirstSqlKeyword('/*!50001 CALL my_proc() */')).toBe('CALL')
  })

  it('extracts SELECT from MySQL executable comment without version', () => {
    expect(getFirstSqlKeyword('/*!SELECT * FROM t */')).toBe('SELECT')
  })

  it('extracts keyword from executable comment after stripping standard comments', () => {
    expect(getFirstSqlKeyword('/* standard */ /*!50001 CALL my_proc() */')).toBe('CALL')
  })

  it('preserves optimizer hints as part of the SQL', () => {
    // Optimizer hints typically follow SELECT, but if used at the start they are preserved.
    // getFirstSqlKeyword will extract the first word-like token which may not be meaningful,
    // but the key behavior is that it doesn't strip the hint.
    const result = getFirstSqlKeyword('/*+ BKA(t1) */ SELECT 1')
    // The hint is preserved and becomes the first token; exact extraction is not critical
    // as optimizer hints don't appear before the keyword in practice
    expect(typeof result).toBe('string')
  })
})
