import { describe, expect, it } from 'vitest'
import { language } from 'monaco-sql-languages/esm/languages/mysql/mysql.js'
import { STAR_OPERATOR_RULE } from '../../../components/query-editor/mysql-language-setup'

describe('mysql language setup — star operator token', () => {
  it('adds the `*` rule once, just before the generic operator-symbol rule', () => {
    const root = language.tokenizer.root
    expect(root.filter((rule: unknown) => rule === STAR_OPERATOR_RULE)).toHaveLength(1)
    expect(root.indexOf(STAR_OPERATOR_RULE)).toBe(root.length - 2)
    const [pattern, token] = STAR_OPERATOR_RULE
    expect(token).toBe('operator.star')
    expect(pattern.test('*')).toBe(true)
    expect(pattern.test('=')).toBe(false)
  })
})
