import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { logFrontend } from '../../lib/app-log-commands'

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('logFrontend', () => {
  it('calls invoke with level and message', async () => {
    let capturedArgs: Record<string, unknown> | undefined
    mockIPC((cmd, args) => {
      if (cmd === 'log_frontend') {
        capturedArgs = args as Record<string, unknown>
        return undefined
      }
      return null
    })

    logFrontend('error', 'Something went wrong')

    // Give the invoke a tick to resolve
    await new Promise((r) => setTimeout(r, 10))
    expect(capturedArgs).toBeDefined()
    expect(capturedArgs!.level).toBe('error')
    expect(capturedArgs!.message).toBe('Something went wrong')
  })

  it('logs to console.error when invoke fails', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockIPC((cmd) => {
      if (cmd === 'log_frontend') {
        throw new Error('IPC failed')
      }
      return null
    })

    logFrontend('warn', 'test message')

    // Give the catch handler a tick
    await new Promise((r) => setTimeout(r, 10))
    expect(consoleSpy).toHaveBeenCalledWith('[app-log]', expect.any(Error))
  })
})
