import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  logBootstrapFailure,
  logFrontend,
  logFrontendError,
  logFrontendWarning,
  logParseFallback,
} from '../../lib/app-log-commands'

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
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

describe('logFrontendError', () => {
  it('logs the message followed by the stringified error at error level', async () => {
    logFrontendError('[store] Load failed:', new Error('disk full'))
    await Promise.resolve()
    expect(ipc.calls('log_frontend')).toContainEqual({
      level: 'error',
      message: '[store] Load failed: Error: disk full',
    })
  })
})

describe('logFrontendWarning', () => {
  it('logs the message followed by the stringified error at warn level', async () => {
    logFrontendWarning('[store] Refresh failed:', 'timeout')
    await Promise.resolve()
    expect(ipc.calls('log_frontend')).toContainEqual({
      level: 'warn',
      message: '[store] Refresh failed: timeout',
    })
  })
})

describe('logParseFallback', () => {
  it('logs the source and the parse error at debug level', async () => {
    logParseFallback('[format-utils] formatShortDate', new RangeError('Invalid time value'))
    await Promise.resolve()
    expect(ipc.calls('log_frontend')).toContainEqual({
      level: 'debug',
      message:
        '[format-utils] formatShortDate could not parse its input, using the fallback: RangeError: Invalid time value',
    })
  })
})

describe('logBootstrapFailure', () => {
  it('writes to the console because IPC is not available during bootstrap', () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bootstrapError = new Error('Monaco failed to load')

    logBootstrapFailure(bootstrapError)

    expect(consoleSpy).toHaveBeenCalledWith('[bootstrap]', bootstrapError)
    expect(ipc.calls('log_frontend')).toHaveLength(0)
  })
})
