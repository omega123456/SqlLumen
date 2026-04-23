import { describe, it, expect } from 'vitest'
import { SLASH_COMMANDS, listCommands, filterCommands, findCommand } from '../../lib/slash-commands'

describe('slash-commands', () => {
  it('registry contains /remember', () => {
    const names = SLASH_COMMANDS.map((c) => c.name)
    expect(names).toContain('remember')
  })

  it('listCommands returns array with at least one entry', () => {
    const cmds = listCommands()
    expect(cmds.length).toBeGreaterThanOrEqual(1)
  })

  it('filterCommands("rem") returns /remember', () => {
    const results = filterCommands('rem')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('remember')
  })

  it('filterCommands("xyz") returns empty array', () => {
    expect(filterCommands('xyz')).toEqual([])
  })

  it('findCommand("remember") returns the command', () => {
    const cmd = findCommand('remember')
    expect(cmd).toBeDefined()
    expect(cmd!.name).toBe('remember')
    expect(cmd!.description).toBeTruthy()
  })

  it('findCommand("unknown") returns undefined', () => {
    expect(findCommand('unknown')).toBeUndefined()
  })

  it('case-insensitive filtering works', () => {
    const results = filterCommands('REM')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('remember')
  })
})
