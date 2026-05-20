import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  resolve(process.cwd(), 'src/components/shared/JsonCellEditor.module.css'),
  'utf8'
)

describe('JsonCellEditor.module.css', () => {
  it('top-aligns the NULL marker for the tall Monaco editor surface', () => {
    expect(css).toMatch(
      /\.editorMarkerGroup\s+:global\(\.td-null-toggle\)\s*{[^}]*align-self:\s*flex-start/s
    )
  })
})
