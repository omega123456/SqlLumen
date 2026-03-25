import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Tauri capabilities', () => {
  it('allows the select_database command for the main window', () => {
    const capabilityPath = resolve(process.cwd(), 'src-tauri/capabilities/default.json')
    const capability = JSON.parse(readFileSync(capabilityPath, 'utf8')) as {
      permissions: string[]
    }

    expect(capability.permissions).toContain('allow-select-database')
  })
})
