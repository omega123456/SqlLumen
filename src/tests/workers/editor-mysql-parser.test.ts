import { describe, expect, it, vi } from 'vitest'
import { MySqlLexer } from 'dt-sql-parser/dist/lib/mysql/MySqlLexer'
import { EditorMySQLParser } from '../../workers/editor-mysql-parser'

function tokenTypeOf(parser: EditorMySQLParser, sql: string, text: string): number | undefined {
  const token = parser.getAllTokens(sql).find((candidate) => candidate.text === text)
  return token?.type
}

describe('EditorMySQLParser', () => {
  it.each(['active', 'inactive', 'type', 'old', 'select'])(
    'accepts the keyword %s as a qualified column name',
    (keyword) => {
      const parser = new EditorMySQLParser()
      const sql = `SELECT t.${keyword} FROM db.t AS t WHERE t.${keyword} = 1`

      expect(parser.validate(sql)).toEqual([])
    }
  )

  it('accepts a keyword after a database and table qualifier', () => {
    const parser = new EditorMySQLParser()

    expect(parser.validate('SELECT db.t.active FROM db.t')).toEqual([])
  })

  it('reads a keyword after a dot and whitespace as an identifier', () => {
    const parser = new EditorMySQLParser()

    expect(tokenTypeOf(parser, 'SELECT smp. active FROM t AS smp', 'active')).toBe(MySqlLexer.ID)
  })

  it('keeps an unqualified keyword as a keyword', () => {
    const parser = new EditorMySQLParser()

    expect(tokenTypeOf(parser, 'SELECT CAST(t.x AS CHAR) FROM t', 'CAST')).toBe(MySqlLexer.KW_CAST)
    expect(parser.validate('SELECT CAST(t.x AS CHAR), t.* FROM t')).toEqual([])
  })

  it('collects the tables of a statement that selects a keyword-named column', () => {
    const parser = new EditorMySQLParser()

    const entities = parser.getAllEntities('SELECT smp.active, smp.redirect FROM seo AS smp') ?? []

    expect(entities.map((entity) => entity.text)).toContain('seo')
  })

  it('reports parse errors only to an explicit error listener', () => {
    const parser = new EditorMySQLParser()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const errorListener = vi.fn()

    parser.createParser('SELEC 1').program()
    parser.createParser('SELEC 1', errorListener).program()

    expect(consoleError).not.toHaveBeenCalled()
    expect(errorListener).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('keeps lexer errors out of the console', () => {
    const parser = new EditorMySQLParser()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    parser.createParser('SELECT 1 ~~ ¬').program()

    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  describe('after an unfinished statement earlier in the editor', () => {
    const sql = "-- note\n\nSELECT 1\n\nselect\n\nSELECT * FROM t WHERE t.name = '';\n\nca"
    const caretPosition = { lineNumber: 9, column: 3 }

    it('suggests statement keywords for the next statement', () => {
      const parser = new EditorMySQLParser()

      const suggestions = parser.getSuggestionAtCaretPosition(sql, caretPosition)

      expect(suggestions?.keywords).toContain('CALL')
    })

    it('reports the syntax errors', () => {
      const parser = new EditorMySQLParser()

      expect(parser.validate(sql).length).toBeGreaterThan(0)
    })
  })
})
