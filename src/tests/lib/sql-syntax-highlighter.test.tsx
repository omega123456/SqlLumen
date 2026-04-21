import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import type { ReactElement } from 'react'
import { SqlSyntaxHighlighter } from '../../lib/sql-syntax-highlighter'

type HighlightNodeProps = {
  className?: string
  children?: string
}

function getHighlightProps(node: ReactElement<unknown>): HighlightNodeProps {
  return node.props as HighlightNodeProps
}

describe('SqlSyntaxHighlighter', () => {
  it('highlights keywords, identifiers, types, and strings', () => {
    const nodes = SqlSyntaxHighlighter.highlightSql(
      "CREATE TABLE `users` (name VARCHAR(255) DEFAULT 'guest')"
    )

    const html = nodes
      .map((node) => {
        if (typeof node === 'string') {
          return node
        }
        if (isValidElement(node)) {
          return getHighlightProps(node).className ?? ''
        }
        return ''
      })
      .join(' ')

    expect(html).toContain('keyword')
    expect(html).toContain('identifier')
    expect(html).toContain('type')
    expect(html).toContain('string')
  })

  it('applies provided css module class names together with global token classes', () => {
    const nodes = SqlSyntaxHighlighter.highlightSql(
      "ALTER TABLE `users` ADD COLUMN age INT DEFAULT '1'",
      {
        keyword: 'kwLocal',
        identifier: 'idLocal',
        type: 'typeLocal',
        string: 'strLocal',
      }
    )

    const classNames = nodes
      .filter((node) => isValidElement(node))
      .map((node) => getHighlightProps(node).className ?? '')
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

  it('highlights function DDL keywords and data types', () => {
    const nodes = SqlSyntaxHighlighter.highlightSql(
      'CREATE FUNCTION `fn_total`(order_id BIGINT) RETURNS DECIMAL(10,2) DETERMINISTIC BEGIN RETURN 0 END'
    )

    const html = nodes
      .map((node) => {
        if (typeof node === 'string') {
          return node
        }
        if (isValidElement(node)) {
          const props = getHighlightProps(node)
          return `${props.children ?? ''}:${props.className ?? ''}`
        }
        return ''
      })
      .join(' ')

    expect(html).toContain('CREATE:keyword')
    expect(html).toContain('FUNCTION:keyword')
    expect(html).toContain('RETURNS:keyword')
    expect(html).toContain('DETERMINISTIC:keyword')
    expect(html).toContain('BIGINT:type')
    expect(html).toContain('DECIMAL:type')
  })
})
