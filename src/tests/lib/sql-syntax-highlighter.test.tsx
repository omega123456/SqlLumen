import { describe, expect, it } from 'vitest'
import { SqlSyntaxHighlighter } from '../../lib/sql-syntax-highlighter'

describe('SqlSyntaxHighlighter', () => {
  it('highlights keywords, identifiers, types, and strings', () => {
    const nodes = SqlSyntaxHighlighter.highlightSql(
      "CREATE TABLE `users` (name VARCHAR(255) DEFAULT 'guest')"
    )

    const html = nodes
      .map((node) => (typeof node === 'string' ? node : (node.props.className as string)))
      .join(' ')

    expect(html).toContain('keyword')
    expect(html).toContain('identifier')
    expect(html).toContain('type')
    expect(html).toContain('string')
  })

  it('applies provided css module class names together with global token classes', () => {
    const nodes = SqlSyntaxHighlighter.highlightSql("ALTER TABLE `users` ADD COLUMN age INT DEFAULT '1'", {
      keyword: 'kwLocal',
      identifier: 'idLocal',
      type: 'typeLocal',
      string: 'strLocal',
    })

    const classNames = nodes
      .filter((node) => typeof node !== 'string')
      .map((node) => node.props.className as string)
      .join(' ')

    expect(classNames).toContain('kwLocal keyword')
    expect(classNames).toContain('idLocal identifier')
    expect(classNames).toContain('typeLocal type')
    expect(classNames).toContain('strLocal string')
  })

  it('keeps plain SQL fragments as strings', () => {
    const nodes = SqlSyntaxHighlighter.highlightSql('select count(*) from users')
    expect(nodes.some((node) => typeof node === 'string')).toBe(true)
  })

  it('returns unknown matched tokens as plain text', () => {
    const nodes = SqlSyntaxHighlighter.highlightSql('FOOBAR')
    expect(nodes).toEqual(['FOOBAR'])
  })
})
