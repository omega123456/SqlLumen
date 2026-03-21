import { describe, it, expect } from 'vitest'
import { tokenizeSql } from '../../lib/sql-tokenizer'

describe('tokenizeSql', () => {
  it('tokenizes keywords correctly', () => {
    const tokens = tokenizeSql('CREATE TABLE')
    expect(tokens).toEqual([
      { type: 'keyword', text: 'CREATE' },
      { type: 'plain', text: ' ' },
      { type: 'keyword', text: 'TABLE' },
    ])
  })

  it('tokenizes backtick identifiers', () => {
    const tokens = tokenizeSql('`users`')
    expect(tokens).toEqual([{ type: 'identifier', text: '`users`' }])
  })

  it('tokenizes string literals', () => {
    const tokens = tokenizeSql("'hello'")
    expect(tokens).toEqual([{ type: 'string', text: "'hello'" }])
  })

  it('tokenizes string with escaped quotes', () => {
    const tokens = tokenizeSql("'it''s'")
    expect(tokens).toEqual([{ type: 'string', text: "'it''s'" }])
  })

  it('tokenizes line comments', () => {
    const tokens = tokenizeSql('-- this is a comment')
    expect(tokens).toEqual([{ type: 'comment', text: '-- this is a comment' }])
  })

  it('tokenizes block comments', () => {
    const tokens = tokenizeSql('/* block */')
    expect(tokens).toEqual([{ type: 'comment', text: '/* block */' }])
  })

  it('tokenizes numbers', () => {
    const tokens = tokenizeSql('123')
    expect(tokens).toEqual([{ type: 'number', text: '123' }])
  })

  it('tokenizes decimal numbers', () => {
    const tokens = tokenizeSql('12.5')
    expect(tokens).toEqual([{ type: 'number', text: '12.5' }])
  })

  it('tokenizes plain words', () => {
    const tokens = tokenizeSql('mycolumn')
    expect(tokens).toEqual([{ type: 'plain', text: 'mycolumn' }])
  })

  it('tokenizes mixed SQL', () => {
    const tokens = tokenizeSql("CREATE TABLE `t` (`id` int DEFAULT 'abc')")
    const types = tokens.map((t) => t.type)
    expect(types).toContain('keyword')
    expect(types).toContain('identifier')
    expect(types).toContain('string')
  })

  it('handles unterminated backtick', () => {
    const tokens = tokenizeSql('`incomplete')
    expect(tokens).toEqual([{ type: 'identifier', text: '`incomplete' }])
  })

  it('handles unterminated string', () => {
    const tokens = tokenizeSql("'incomplete")
    expect(tokens).toEqual([{ type: 'string', text: "'incomplete" }])
  })

  it('handles unterminated block comment', () => {
    const tokens = tokenizeSql('/* incomplete')
    expect(tokens).toEqual([{ type: 'comment', text: '/* incomplete' }])
  })

  it('handles empty input', () => {
    const tokens = tokenizeSql('')
    expect(tokens).toEqual([])
  })

  it('handles operators and punctuation as plain tokens', () => {
    const tokens = tokenizeSql('()')
    expect(tokens).toEqual([{ type: 'plain', text: '()' }])
  })

  it('is case-insensitive for keywords', () => {
    const tokens = tokenizeSql('create table')
    expect(tokens[0]).toEqual({ type: 'keyword', text: 'create' })
    expect(tokens[2]).toEqual({ type: 'keyword', text: 'table' })
  })
})
