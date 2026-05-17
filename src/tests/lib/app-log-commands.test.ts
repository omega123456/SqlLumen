import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipc } from '../ipc-mock'
import { logFrontend } from '../../lib/app-log-commands'

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  ipc.reset()
  vi.clearAllMocks()
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('logFrontend', () => {
  it('calls invoke with level and message', async () => {
    logFrontend('error', 'Something went wrong')
    await Promise.resolve()
    expect(ipc.calls('log_frontend')).toContainEqual({
      level: 'error',
      message: 'Something went wrong',
    })
  })

  it('logs to console.error when invoke fails', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ipc.override('log_frontend', () => {
      throw new Error('IPC failed')
    })

    logFrontend('warn', 'test message')
    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('[app-log]', expect.any(Error))
    })
  })
})
