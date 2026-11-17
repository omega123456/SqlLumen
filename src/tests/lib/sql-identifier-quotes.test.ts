import { describe, it, expect } from 'vitest'
import { stripQuotes } from '../../lib/sql-identifier-quotes'

describe('stripQuotes', () => {
  it('removes surrounding backticks', () => {
    expect(stripQuotes('`users`')).toBe('users')
  })

  it('removes surrounding double quotes', () => {
    expect(stripQuotes('"users"')).toBe('users')
  })
})
