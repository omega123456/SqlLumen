const BACKSLASH_ESCAPE_LENGTH = 2
const BLOCK_COMMENT_DELIMITER_LENGTH = 2

export interface StatementRange {
  start: number
  end: number
  sql: string
}

export function splitStatements(sql: string): StatementRange[] {
  return new StatementSplitter(sql).split()
}

const QUOTE_CHARACTERS = new Set(["'", '"', '`'])
const DELIMITER_DIRECTIVE_PATTERN = /^DELIMITER\s+(\S+)/i
const WHITESPACE_PATTERN = /\s/
const DEFAULT_DELIMITER = ';'
const NEWLINE_NOT_FOUND = -1

class StatementSplitter {
  private readonly sql: string
  private readonly results: StatementRange[] = []
  private delimiter = DEFAULT_DELIMITER
  private position = 0
  private statementStart = 0

  constructor(sql: string) {
    this.sql = sql
  }

  split(): StatementRange[] {
    this.skipWhitespace()
    this.statementStart = this.position
    while (this.position < this.sql.length) {
      this.step()
    }
    this.pushStatement(this.sql.length, this.sql.length)
    return this.results
  }

  private step(): void {
    if (this.skipIgnoredSection()) return
    if (this.applyDelimiterDirective()) return
    if (this.endStatementAtDelimiter()) return
    this.position++
  }

  private skipIgnoredSection(): boolean {
    const character = this.sql[this.position]
    if (QUOTE_CHARACTERS.has(character)) {
      this.skipQuoted(character)
      return true
    }
    if (this.sql.startsWith('/*', this.position)) {
      this.skipBlockComment()
      return true
    }
    if (this.isAtLineComment(character)) {
      this.skipToLineEnd()
      return true
    }
    return false
  }

  private skipQuoted(quote: string): void {
    this.position++
    while (this.position < this.sql.length) {
      const character = this.sql[this.position]
      if (character === '\\') {
        this.position += BACKSLASH_ESCAPE_LENGTH
        continue
      }
      this.position++
      if (character === quote) return
    }
  }

  private skipBlockComment(): void {
    this.position += BLOCK_COMMENT_DELIMITER_LENGTH
    while (this.isInsideBlockComment()) {
      this.position++
    }
    this.position += BLOCK_COMMENT_DELIMITER_LENGTH
  }

  private skipToLineEnd(): void {
    while (this.isBeforeLineEnd()) this.position++
  }

  private isAtLineComment(character: string): boolean {
    return this.sql.startsWith('--', this.position) || character === '#'
  }

  private isInsideBlockComment(): boolean {
    const hasNextCharacter = this.position + 1 < this.sql.length
    return hasNextCharacter && !this.sql.startsWith('*/', this.position)
  }

  private isBeforeLineEnd(): boolean {
    return this.position < this.sql.length && this.sql[this.position] !== '\n'
  }

  private isAtWhitespace(): boolean {
    return this.position < this.sql.length && WHITESPACE_PATTERN.test(this.sql[this.position])
  }

  private skipWhitespace(): void {
    while (this.isAtWhitespace()) {
      this.position++
    }
  }

  private isAtLineStart(): boolean {
    return this.position === 0 || this.sql[this.position - 1] === '\n'
  }

  private applyDelimiterDirective(): boolean {
    if (!this.isAtLineStart()) return false
    const directive = this.sql.slice(this.position).match(DELIMITER_DIRECTIVE_PATTERN)
    if (!directive) return false

    this.pushStatement(this.position, this.position)
    this.delimiter = directive[1]
    const lineEnd = this.sql.indexOf('\n', this.position)
    this.position = lineEnd === -1 ? this.sql.length : lineEnd + 1
    this.statementStart = this.position
    return true
  }

  private endStatementAtDelimiter(): boolean {
    if (!this.sql.startsWith(this.delimiter, this.position)) return false
    const statementEnd = this.position + this.delimiter.length
    this.pushStatement(this.position, statementEnd)
    this.position = statementEnd
    this.skipWhitespace()
    this.statementStart = this.position
    return true
  }

  private pushStatement(contentEnd: number, rangeEnd: number): void {
    const statement = this.sql.slice(this.statementStart, contentEnd).trim()
    if (!statement) return
    this.results.push({ start: this.statementStart, end: rangeEnd, sql: statement })
  }
}

export function findStatementAtCursor(
  statements: StatementRange[],
  cursorOffset: number
): StatementRange | null {
  let best: StatementRange | null = null
  for (const statement of statements) {
    const containsCursor = statement.start <= cursorOffset && cursorOffset <= statement.end
    if (containsCursor) {
      best = statement
      break
    }
    if (statement.start <= cursorOffset) {
      best = statement
    }
  }
  return best
}

export function cursorToOffset(sql: string, line: number, column: number): number {
  return lineStartOffset(sql, line) + column - 1
}

function lineStartOffset(sql: string, line: number): number {
  let offset = 0
  for (let currentLine = 1; currentLine < line; currentLine++) {
    const newlineIndex = sql.indexOf('\n', offset)
    if (newlineIndex === NEWLINE_NOT_FOUND) return sql.length
    offset = newlineIndex + 1
  }
  return offset
}
