import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const resultPanelCss = readFileSync(
  resolve(process.cwd(), 'src/components/query-editor/ResultPanel.module.css'),
  'utf8'
)

describe('ResultPanel grid layout isolation', () => {
  it('paint- and layout-contains mounted grid view so it does not invalidate Monaco siblings', () => {
    const gridPanelRule = resultPanelCss.match(/\.gridTabPanel\s*\{([^}]+)\}/)

    expect(gridPanelRule).not.toBeNull()
    expect(gridPanelRule![1]).toMatch(/contain:\s*[^;]*\blayout\b[^;]*\bpaint\b[^;]*\bstyle\b/)
    expect(gridPanelRule![1]).toMatch(/isolation:\s*isolate/)
  })
})
