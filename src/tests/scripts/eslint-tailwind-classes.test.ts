import { describe, expect, it } from 'vitest'
import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { tailwindRulesPlugin } from '../../../scripts/eslint-tailwind-classes.mjs'

const RULE_ID = 'local/tailwind-classes'
const COMPONENT_FILE = 'fixture-component.tsx'
const CLASS_CONSTANT_FILE = 'class-names.ts'
const THEME_TOKENS_FILE = 'theme-tokens.ts'

const config: Linter.Config[] = [
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { local: tailwindRulesPlugin },
    rules: { [RULE_ID]: 'error' },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
]

function reportedMessages(source: string, filename: string): string[] {
  const linter = new Linter({ configType: 'flat', cwd: process.cwd() })
  const messages = linter.verify(source, config, { filename: filename })
  return messages.map((message) => message.message)
}

function componentWithClassName(classNameExpression: string): string {
  return `export const Panel = () => <div className=${classNameExpression} />`
}

describe('local/tailwind-classes', () => {
  it('accepts paired light and dark utilities', () => {
    const source = componentWithClassName(
      '"bg-light-surface dark:bg-dark-surface hover:bg-light-hover dark:hover:bg-dark-hover"'
    )
    expect(reportedMessages(source, COMPONENT_FILE)).toEqual([])
  })

  it('rejects a light utility without its dark twin', () => {
    const source = componentWithClassName('"bg-light-surface hover:bg-light-hover"')
    expect(reportedMessages(source, COMPONENT_FILE)).toEqual([
      'Class "bg-light-surface" has no "dark:bg-dark-surface" twin in the same string',
      'Class "hover:bg-light-hover" has no "dark:hover:bg-dark-hover" twin in the same string',
    ])
  })

  it('rejects a dark twin that carries different variants', () => {
    const source = componentWithClassName('"hover:bg-light-hover dark:bg-dark-hover"')
    expect(reportedMessages(source, COMPONENT_FILE)).toHaveLength(1)
  })

  it('rejects square brackets and css variable shorthand', () => {
    const source = componentWithClassName('"w-[237px] h-(--row) data-[state=open]:flex"')
    expect(reportedMessages(source, COMPONENT_FILE)).toHaveLength(3)
  })

  it('rejects the important modifier', () => {
    const source = componentWithClassName('"!p-0 hover:!p-1"')
    expect(reportedMessages(source, COMPONENT_FILE)).toHaveLength(2)
  })

  it('rejects interpolated class fragments in className', () => {
    const source = componentWithClassName('{`p-${size} flex`}')
    expect(reportedMessages(source, COMPONENT_FILE)).toEqual([
      'Class strings must be full literals, never built with interpolation',
    ])
  })

  it('checks both branches of a conditional className', () => {
    const source = componentWithClassName('{isOpen ? "bg-light-card" : "flex"}')
    expect(reportedMessages(source, COMPONENT_FILE)).toHaveLength(1)
  })

  it('accepts a template literal without interpolation', () => {
    const source = componentWithClassName('{`flex items-center`}')
    expect(reportedMessages(source, COMPONENT_FILE)).toEqual([])
  })

  it('ignores className values that are not literals', () => {
    const source = componentWithClassName('{CARD_SURFACE}')
    expect(reportedMessages(source, COMPONENT_FILE)).toEqual([])
  })

  it('ignores attributes other than className', () => {
    const source = 'export const Panel = () => <div title="w-[1px] !p-0" />'
    expect(reportedMessages(source, COMPONENT_FILE)).toEqual([])
  })

  it('checks every string in a class constant file', () => {
    const source = "export const CARD = 'rounded-card bg-light-card w-[3px]'"
    expect(reportedMessages(source, CLASS_CONSTANT_FILE)).toHaveLength(2)
  })

  it('rejects interpolated templates in a class constant file', () => {
    const source = 'export const card = (size: string) => `p-${size}`'
    expect(reportedMessages(source, CLASS_CONSTANT_FILE)).toEqual([
      'Class strings must be full literals, never built with interpolation',
    ])
  })

  it('does not treat strings in ordinary files as class strings', () => {
    const source = "export const note = 'w-[3px] bg-light-card'"
    expect(reportedMessages(source, 'notes.ts')).toEqual([])
  })

  it('rejects raw css variable strings outside theme-tokens', () => {
    const source = "export const colour = 'var(--primary)'\nexport const other = `var(--x)`"
    expect(reportedMessages(source, 'colours.ts')).toHaveLength(2)
  })

  it('allows raw css variable strings in theme-tokens', () => {
    const source = "export const colour = 'var(--primary)'"
    expect(reportedMessages(source, THEME_TOKENS_FILE)).toEqual([])
  })
})
