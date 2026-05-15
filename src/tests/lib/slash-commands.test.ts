import { describe, it, expect, vi, beforeEach } from 'vitest'
const mockSaveMemory = vi.fn()
const mockShowSuccessToast = vi.fn()
const mockShowErrorToast = vi.fn()
const mockLogFrontend = vi.fn()

vi.mock('../../lib/ai-memory-commands', () => ({
  saveMemory: (...args: unknown[]) => mockSaveMemory(...args),
}))

vi.mock('../../stores/toast-store', () => ({
  showSuccessToast: (...args: unknown[]) => mockShowSuccessToast(...args),
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
}))

vi.mock('../../lib/app-log-commands', () => ({
  logFrontend: (...args: unknown[]) => mockLogFrontend(...args),
}))

import { SLASH_COMMANDS, listCommands, filterCommands, findCommand } from '../../lib/slash-commands'

describe('slash-commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveMemory.mockResolvedValue(undefined)
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

    expect(mockSaveMemory).toHaveBeenCalledWith({
      sessionId: 'session-1',
      content: 'save this note',
    })
    expect(mockShowSuccessToast).toHaveBeenCalledWith('Memory saved')
  })

  it('rejects /remember with empty args and shows an error toast', async () => {
    const remember = findCommand('remember')

    await expect(remember!.execute('   ', 'session-1')).rejects.toThrow(
      'Cannot save empty memory. Usage: /remember <text>'
    )

    expect(mockShowErrorToast).toHaveBeenCalledWith('Please provide text to remember')
    expect(mockSaveMemory).not.toHaveBeenCalled()
  })

  it('logs and rethrows when /remember fails to save', async () => {
    const remember = findCommand('remember')
    const error = new Error('backend unavailable')
    mockSaveMemory.mockRejectedValueOnce(error)

    await expect(remember!.execute('remember me', 'session-1')).rejects.toThrow(
      'backend unavailable'
    )

    expect(mockLogFrontend).toHaveBeenCalledWith(
      'error',
      '[slash-commands] /remember failed: backend unavailable'
    )
    expect(mockShowErrorToast).toHaveBeenCalledWith(
      'Failed to save memory',
      'backend unavailable'
    )
  })
})
