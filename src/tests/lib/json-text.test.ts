import { describe, expect, it, vi } from 'vitest'
import { normalizeJson, prettyPrintJson } from '../../lib/json-text'
import { ipc } from '../ipc-mock'

async function expectDebugLogStartingWith(prefix: string): Promise<void> {
  await vi.waitFor(() => {
    expect(ipc.calls('log_frontend')).toContainEqual({
      level: 'debug',
      message: expect.stringContaining(prefix),
    })
  })
}

describe('prettyPrintJson', () => {
  it('indents valid JSON by two spaces', () => {
    expect(prettyPrintJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}')
  })

  it('returns the input unchanged and logs a debug line for invalid JSON', async () => {
    expect(prettyPrintJson('{not json')).toBe('{not json')
    await expectDebugLogStartingWith('[json-text] prettyPrintJson could not parse its input')
  })
})

describe('normalizeJson', () => {
  it('removes insignificant whitespace from valid JSON', () => {
    expect(normalizeJson('{ "a" : 1 }')).toBe('{"a":1}')
  })

  it('returns null and logs a debug line for invalid JSON', async () => {
    expect(normalizeJson('{not json')).toBeNull()
    await expectDebugLogStartingWith('[json-text] normalizeJson could not parse its input')
  })
})
