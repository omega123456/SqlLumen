import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const globalCss = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')
const resetCss = readFileSync(resolve(process.cwd(), 'src/styles/reset.css'), 'utf8')

const allGlobalStyles = resetCss + '\n' + globalCss

describe('user-select policy', () => {
  it('should set user-select: none on body or root element to prevent text selection globally', () => {
    // A desktop app should disable text selection by default on the body/#root/*
    // and selectively re-enable it on code blocks, schema tables, and input fields.
    const hasGlobalUserSelectNone =
      /body\s*\{[^}]*user-select:\s*none/s.test(allGlobalStyles) ||
      /#root\s*\{[^}]*user-select:\s*none/s.test(allGlobalStyles) ||
      /\*\s*\{[^}]*user-select:\s*none/s.test(allGlobalStyles) ||
      /html\s*\{[^}]*user-select:\s*none/s.test(allGlobalStyles)

    expect(hasGlobalUserSelectNone).toBe(true)
  })

  it('should re-enable user-select: text on schema-info table elements', () => {
    // Schema info panels (ColumnsPanel, IndexesPanel, ForeignKeysPanel, DdlPanel, etc.)
    // contain data tables and DDL that users need to select/copy.
    // The global allowlist must include selectors that cover these elements,
    // or the schema-info module CSS must set user-select: text.
    const schemaInfoModules = [
      'ColumnsPanel.module.css',
      'IndexesPanel.module.css',
      'ForeignKeysPanel.module.css',
      'DdlPanel.module.css',
      'MetadataCard.module.css',
      'StatsRow.module.css',
    ]

    // Check if global.css allowlist covers generic table elements (td, th, table)
    const globalAllowsTableElements = /(?:^|,)\s*(?:td|th|table|\.schema-info)\s*(?:,|\{)/m.test(
      globalCss
    )

    // Check if any schema-info module CSS sets user-select: text
    const anyModuleSetsUserSelect = schemaInfoModules.some((file) => {
      try {
        const css = readFileSync(resolve(process.cwd(), 'src/components/schema-info', file), 'utf8')
        return /user-select:\s*text/.test(css)
      } catch {
        return false
      }
    })

    expect(
      globalAllowsTableElements || anyModuleSetsUserSelect,
      'Schema info table/DDL content must be selectable: either global.css allowlist ' +
        'should include table elements or schema-info module CSS should set user-select: text'
    ).toBe(true)
  })
})
