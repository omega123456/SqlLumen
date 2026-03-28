import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('playwright screenshot runner', () => {
  it('does not enable elevated screenshot worker mode', () => {
    const scriptPath = path.resolve('scripts/playwright-screenshots.mjs')
    const source = readFileSync(scriptPath, 'utf8')

    expect(source).not.toContain("process.env.PLAYWRIGHT_SCREENSHOT_RUN = '1'")
  })
})
