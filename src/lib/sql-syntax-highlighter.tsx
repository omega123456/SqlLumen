import type { ReactNode } from 'react'

type TokenClassNameMap = {
  keyword?: string
  identifier?: string
  type?: string
  string?: string
}

export class SqlSyntaxHighlighter {
  private static readonly KEYWORDS = new Set([
    'CREATE',
    'TABLE',
    'VIEW',
    'PROCEDURE',
    'FUNCTION',
    'TRIGGER',
    'EVENT',
    'ALTER',
    'ADD',
    'DROP',
    'MODIFY',
    'COLUMN',
    'INDEX',
    'UNIQUE',
    'PRIMARY',
    'KEY',
    'FOREIGN',
    'REFERENCES',
    'ENGINE',
    'DEFAULT',
    'CHARSET',
    'COLLATE',
    'AS',
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'FROM',
    'WHERE',
    'GROUP',
    'ORDER',
    'BY',
    'HAVING',
    'LIMIT',
    'DISTINCT',
    'NOT',
    'NULL',
    'IS',
    'AND',
    'OR',
    'AUTO_INCREMENT',
    'CONSTRAINT',
    'BEGIN',
    'END',
    'RETURNS',
    'RETURN',
    'DECLARE',
    'SET',
    'IF',
    'THEN',
    'ELSE',
    'CASE',
    'WHILE',
    'REPEAT',
    'UNTIL',
    'LOOP',
    'LEAVE',
    'ITERATE',
    'CALL',
    'FOR',
    'EACH',
    'ROW',
    'DEFINER',
    'DETERMINISTIC',
    'CONTAINS',
    'READS',
    'MODIFIES',
    'SQL',
    'DATA',
    'SECURITY',
    'INVOKER',
    'IN',
    'OUT',
    'INOUT',
    'DO',
    'WHEN',
    'BEFORE',
    'AFTER',
    'EXISTS',
  ])

  private static readonly TYPES = new Set([
    'INT',
    'INTEGER',
    'TINYINT',
    'SMALLINT',
    'MEDIUMINT',
    'BIGINT',
    'VARCHAR',
    'CHAR',
    'TEXT',
    'TINYTEXT',
    'MEDIUMTEXT',
    'LONGTEXT',
    'BLOB',
    'TINYBLOB',
    'MEDIUMBLOB',
    'LONGBLOB',
    'DECIMAL',
    'NUMERIC',
    'FLOAT',
    'DOUBLE',
    'REAL',
    'BIT',
    'DATE',
    'DATETIME',
    'TIMESTAMP',
    'TIME',
    'YEAR',
    'BINARY',
    'VARBINARY',
    'JSON',
    'BOOLEAN',
    'BOOL',
    'ENUM',
    'SET',
    'SIGNED',
    'UNSIGNED',
  ])

  private static readonly IDENTIFIER_PATTERN = '`[^`]+`'
  private static readonly STRING_PATTERN = String.raw`'(?:[^'\\]|\\.)*'`
  private static readonly TOKEN_REGEX = new RegExp(
    `(${SqlSyntaxHighlighter.IDENTIFIER_PATTERN}|${SqlSyntaxHighlighter.STRING_PATTERN}|\\b(?:${Array.from(SqlSyntaxHighlighter.KEYWORDS, SqlSyntaxHighlighter.escapeRegexToken).join('|')})\\b|\\b(?:${Array.from(SqlSyntaxHighlighter.TYPES, SqlSyntaxHighlighter.escapeRegexToken).join('|')})\\b|\\b[A-Z_]+\\b)`,
    'gi'
  )

  private static escapeRegexToken(token: string): string {
    return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  private static joinClasses(...parts: Array<string | undefined>): string {
    return parts.filter(Boolean).join(' ')
  }

  private static renderToken(
    token: string,
    key: string,
    classNames: TokenClassNameMap = {}
  ): ReactNode {
    if (token.startsWith('`')) {
      return (
        <span
          key={key}
          className={SqlSyntaxHighlighter.joinClasses(classNames.identifier, 'identifier')}
        >
          {token}
        </span>
      )
    }

    if (token.startsWith("'")) {
      return (
        <span key={key} className={SqlSyntaxHighlighter.joinClasses(classNames.string, 'string')}>
          {token}
        </span>
      )
    }

    const normalizedToken = token.toUpperCase()

    if (SqlSyntaxHighlighter.KEYWORDS.has(normalizedToken)) {
      return (
        <span key={key} className={SqlSyntaxHighlighter.joinClasses(classNames.keyword, 'keyword')}>
          {token}
        </span>
      )
    }

    if (SqlSyntaxHighlighter.TYPES.has(normalizedToken)) {
      return (
        <span key={key} className={SqlSyntaxHighlighter.joinClasses(classNames.type, 'type')}>
          {token}
        </span>
      )
    }

    return token
  }

  static highlightSql(sql: string, classNames?: TokenClassNameMap): ReactNode[] {
    const nodes: ReactNode[] = []
    let lastIndex = 0
    let matchIndex = 0

    for (const match of sql.matchAll(SqlSyntaxHighlighter.TOKEN_REGEX)) {
      const token = match[0]
      const index = match.index ?? 0

      if (index > lastIndex) {
        nodes.push(sql.slice(lastIndex, index))
      }

      nodes.push(SqlSyntaxHighlighter.renderToken(token, `token-${matchIndex}`, classNames))
      lastIndex = index + token.length
      matchIndex += 1
    }

    if (lastIndex < sql.length) {
      nodes.push(sql.slice(lastIndex))
    }

    return nodes
  }
}
