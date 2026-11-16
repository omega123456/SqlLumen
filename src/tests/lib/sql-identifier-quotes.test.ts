import { describe, it, expect } from 'vitest'
import { stripQuotes } from '../../lib/sql-identifier-quotes'

describe('stripQuotes', () => {
  it('removes surrounding backticks', () => {
    expect(stripQuotes('`users`')).toBe('users')
  })

  it('removes surrounding double quotes', () => {
    expect(stripQuotes('"users"')).toBe('users')
  })

  it('removes surrounding single quotes', () => {
    expect(stripQuotes("'users'")).toBe('users')
  })

  it('returns the string unchanged if no surrounding quotes', () => {
    expect(stripQuotes('users')).toBe('users')
  })

  it('returns empty string unchanged', () => {
    expect(stripQuotes('')).toBe('')
  })

  it('returns single char unchanged', () => {
    expect(stripQuotes('a')).toBe('a')
  })

  it('does not strip mismatched quotes', () => {
    expect(stripQuotes('`users"')).toBe('`users"')
    expect(stripQuotes('"users`')).toBe('"users`')
  })

  it('strips to empty when quotes surround nothing', () => {
    expect(stripQuotes('``')).toBe('')
    expect(stripQuotes('""')).toBe('')
    expect(stripQuotes("''")).toBe('')
  })

  it('only strips the outermost quotes', () => {
    expect(stripQuotes('`"inner"`')).toBe('"inner"')
  })
})
