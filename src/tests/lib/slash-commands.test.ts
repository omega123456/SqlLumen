import { describe, it, expect, beforeEach } from 'vitest'
import { ipc, expectToast } from '../ipc-mock'
import {
  SLASH_COMMANDS,
  listCommands,
  filterCommands,
  findCommand,
  executeRemember,
  resolveRememberScope,
} from '../../lib/slash-commands'
import { useSettingsStore } from '../../stores/settings-store'

function setRememberScope(value: string): void {
  useSettingsStore.setState({ settings: { 'ai.rememberScope': value } } as never)
}

describe('slash-commands', () => {
  beforeEach(() => {
    // Default: save_memory succeeds (already in fixtures)
    // Reset to a known concrete default scope for each test.
    setRememberScope('connection')
  })

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

  it('executes /remember with trimmed args and shows success toast', async () => {
    const remember = findCommand('remember')

    await remember!.execute('  save this note  ', 'session-1')

    const calls = ipc.calls('save_memory')
    expect(calls).toHaveLength(1)
    const args = calls[0] as Record<string, unknown>
    expect(args).toMatchObject({
      sessionId: 'session-1',
      content: 'save this note',
    })
    await expectToast('success', 'Memory saved')
  })

  it('rejects /remember with empty args and shows an error toast', async () => {
    const remember = findCommand('remember')

    await expect(remember!.execute('   ', 'session-1')).rejects.toThrow(
      'Cannot save empty memory. Usage: /remember <text>'
    )

    await expectToast('error', 'Please provide text to remember')
    expect(ipc.calls('save_memory')).toHaveLength(0)
  })

  it('logs and rethrows when /remember fails to save', async () => {
    const remember = findCommand('remember')
    ipc.override('save_memory', () => {
      throw new Error('backend unavailable')
    })

    await expect(remember!.execute('remember me', 'session-1')).rejects.toThrow(
      'backend unavailable'
    )

    const logCalls = ipc.calls('log_frontend')
    const matched = logCalls.some((call) => {
      const a = call as Record<string, unknown>
      return (
        a.level === 'error' &&
        typeof a.message === 'string' &&
        a.message.includes('[slash-commands] /remember failed: backend unavailable')
      )
    })
    expect(matched).toBe(true)

    await expectToast('error', 'Failed to save memory')
  })

  describe('scope resolution', () => {
    it('resolveRememberScope reads the setting value', () => {
      setRememberScope('global')
      expect(resolveRememberScope()).toBe('global')
    })

    it('resolveRememberScope falls back to connection for unknown values', () => {
      setRememberScope('bogus')
      expect(resolveRememberScope()).toBe('connection')
    })

    it('executeRemember saves at the default scope and returns a saved result', async () => {
      setRememberScope('global')
      const result = await executeRemember('a global note', 'session-1')
      expect(result.type).toBe('saved')
      const calls = ipc.calls('save_memory')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        sessionId: 'session-1',
        content: 'a global note',
        scope: 'global',
      })
      await expectToast('success', 'Memory saved')
    })

    it('executeRemember honors an explicit caller-provided scope over the setting', async () => {
      setRememberScope('connection')
      await executeRemember('group note', 'session-1', 'group')
      const calls = ipc.calls('save_memory')
      expect(calls[0]).toMatchObject({ scope: 'group' })
    })

    it('executeRemember returns ask without saving when scope is "ask"', async () => {
      setRememberScope('ask')
      const result = await executeRemember('  unsure note  ', 'session-1')
      expect(result).toEqual({ type: 'ask', content: 'unsure note' })
      expect(ipc.calls('save_memory')).toHaveLength(0)
    })

    it('executeRemember rejects empty input regardless of scope', async () => {
      setRememberScope('ask')
      await expect(executeRemember('   ', 'session-1')).rejects.toThrow(
        'Cannot save empty memory. Usage: /remember <text>'
      )
      expect(ipc.calls('save_memory')).toHaveLength(0)
    })
  })
})
