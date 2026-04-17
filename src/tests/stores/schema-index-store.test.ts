import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useSchemaIndexStore } from '../../stores/schema-index-store'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/app-log-commands', () => ({
  logFrontend: vi.fn(),
}))

const mockBuildSchemaIndex = vi.fn().mockResolvedValue(undefined)
const mockForceRebuildSchemaIndex = vi.fn().mockResolvedValue(undefined)
const mockInvalidateSchemaIndex = vi.fn().mockResolvedValue(undefined)
const mockGetIndexStatus = vi.fn().mockResolvedValue({ status: 'stale' })

vi.mock('../../lib/schema-index-commands', () => ({
  buildSchemaIndex: (...args: unknown[]) => mockBuildSchemaIndex(...args),
  forceRebuildSchemaIndex: (...args: unknown[]) => mockForceRebuildSchemaIndex(...args),
  invalidateSchemaIndex: (...args: unknown[]) => mockInvalidateSchemaIndex(...args),
  getIndexStatus: (...args: unknown[]) => mockGetIndexStatus(...args),
  semanticSearch: vi.fn().mockResolvedValue([]),
  listIndexedTables: vi.fn().mockResolvedValue([]),
}))

let settingsSubscriber: ((state: { getSetting: (key: string) => string }) => void) | null = null
let currentEmbeddingModel = ''

vi.mock('../../stores/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      getSetting: (key: string) => {
        if (key === 'ai.embeddingModel') return currentEmbeddingModel
        return ''
      },
    }),
    subscribe: vi.fn((cb: (state: { getSetting: (key: string) => string }) => void) => {
      settingsSubscriber = cb
      return () => {
        settingsSubscriber = null
      }
    }),
  },
}))

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Reset the store state
  useSchemaIndexStore.setState({
    connections: {},
    profileToSessions: {},
    sessionToProfile: {},
  })
  vi.clearAllMocks()
  mockBuildSchemaIndex.mockResolvedValue(undefined)
  mockForceRebuildSchemaIndex.mockResolvedValue(undefined)
  mockInvalidateSchemaIndex.mockResolvedValue(undefined)
  mockGetIndexStatus.mockResolvedValue({ status: 'stale' })
  currentEmbeddingModel = ''
  // Note: settingsSubscriber is NOT reset here because initSettingsSubscription
  // only runs once (it has an internal guard). The subscriber persists across tests.

  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'build_schema_index') return undefined
    if (cmd === 'force_rebuild_schema_index') return undefined
    if (cmd === 'get_index_status') return { status: 'ready' }
    if (cmd === 'invalidate_schema_index') return undefined
    if (cmd === 'semantic_search') return []
    if (cmd === 'list_indexed_tables') return []
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

import { afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSchemaIndexStore', () => {
  describe('registerSession', () => {
    it('stores session-profile mapping', async () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')

      const state = useSchemaIndexStore.getState()
      expect(state.sessionToProfile['session-1']).toBe('profile-1')
      expect(state.profileToSessions['profile-1']).toContain('session-1')
      expect(state.connections['session-1']).toBeDefined()
      // Initially stale, then updated by async getIndexStatus
      expect(state.connections['session-1'].status).toBe('stale')

      // Wait for async status fetch
      await vi.waitFor(() => {
        expect(mockGetIndexStatus).toHaveBeenCalledWith('session-1')
      })
    })

    it('stores multiple sessions for the same profile', () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState().registerSession('session-2', 'profile-1')

      const state = useSchemaIndexStore.getState()
      expect(state.profileToSessions['profile-1']).toEqual(['session-1', 'session-2'])
    })

    it('updates status from backend on registration', async () => {
      mockGetIndexStatus.mockResolvedValueOnce({ status: 'ready' })
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')

      await vi.waitFor(() => {
        const state = useSchemaIndexStore.getState()
        expect(state.connections['session-1'].status).toBe('ready')
      })
    })

    it('handles getIndexStatus failure gracefully on registration', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockGetIndexStatus.mockRejectedValueOnce(new Error('Status check failed'))
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')

      await vi.waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('[schema-index-store] Failed to get initial index status'),
          expect.any(String)
        )
      })

      // Status should remain at the default 'stale'
      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('stale')
    })
  })

  describe('unregisterSession', () => {
    it('cleans up session mappings', () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState().unregisterSession('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.sessionToProfile['session-1']).toBeUndefined()
      expect(state.connections['session-1']).toBeUndefined()
      expect(state.profileToSessions['profile-1']).toBeUndefined()
    })

    it('preserves other sessions for the same profile', () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState().registerSession('session-2', 'profile-1')
      useSchemaIndexStore.getState().unregisterSession('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.profileToSessions['profile-1']).toEqual(['session-2'])
      expect(state.connections['session-2']).toBeDefined()
    })

    it('does nothing for unknown session', () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState().unregisterSession('unknown-session')

      const state = useSchemaIndexStore.getState()
      expect(state.sessionToProfile['session-1']).toBe('profile-1')
    })
  })

  describe('_handleProgress', () => {
    it('updates status to building with correct counts and phase', () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState()._handleProgress('profile-1', 'embedding', 5, 10)

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('building')
      expect(state.connections['session-1'].phase).toBe('embedding')
      expect(state.connections['session-1'].tablesDone).toBe(5)
      expect(state.connections['session-1'].tablesTotal).toBe(10)
    })

    it('stores loading_schema phase with zero total', () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState()._handleProgress('profile-1', 'loading_schema', 7, 0)

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].phase).toBe('loading_schema')
      expect(state.connections['session-1'].tablesDone).toBe(7)
      expect(state.connections['session-1'].tablesTotal).toBe(0)
    })

    it('stores finalizing phase after table indexing reaches completion', () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState()._handleProgress('profile-1', 'finalizing', 10, 10)

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].phase).toBe('finalizing')
      expect(state.connections['session-1'].tablesDone).toBe(10)
      expect(state.connections['session-1'].tablesTotal).toBe(10)
    })

    it('updates all sessions for the profile', () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState().registerSession('session-2', 'profile-1')
      useSchemaIndexStore.getState()._handleProgress('profile-1', 'embedding', 3, 8)

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('building')
      expect(state.connections['session-1'].phase).toBe('embedding')
      expect(state.connections['session-1'].tablesDone).toBe(3)
      expect(state.connections['session-2'].status).toBe('building')
      expect(state.connections['session-2'].phase).toBe('embedding')
      expect(state.connections['session-2'].tablesDone).toBe(3)
    })
  })

  describe('_handleComplete', () => {
    it('updates status to ready with timestamp and clears phase', () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState()._handleProgress('profile-1', 'embedding', 5, 10)
      const beforeTime = Date.now()
      useSchemaIndexStore.getState()._handleComplete('profile-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('ready')
      expect(state.connections['session-1'].phase).toBeNull()
      expect(state.connections['session-1'].lastBuildTimestamp).toBeGreaterThanOrEqual(beforeTime)
    })
  })

  describe('_handleError', () => {
    it('updates status to error with message and clears phase', () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState()._handleProgress('profile-1', 'loading_schema', 0, 0)
      useSchemaIndexStore.getState()._handleError('profile-1', 'Something went wrong')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('error')
      expect(state.connections['session-1'].phase).toBeNull()
      expect(state.connections['session-1'].error).toBe('Something went wrong')
    })
  })

  describe('triggerBuild', () => {
    it('calls buildSchemaIndex and checks status after', async () => {
      mockGetIndexStatus.mockResolvedValueOnce({ status: 'building' })
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(mockGetIndexStatus).toHaveBeenCalledWith('session-1')
      })
      mockGetIndexStatus.mockClear()
      mockGetIndexStatus.mockResolvedValueOnce({ status: 'building' })

      await useSchemaIndexStore.getState().triggerBuild('session-1')

      expect(mockBuildSchemaIndex).toHaveBeenCalledWith('session-1')
      // getIndexStatus should have been called after buildSchemaIndex
      expect(mockGetIndexStatus).toHaveBeenCalledWith('session-1')
    })

    it('does nothing for unknown session', async () => {
      await useSchemaIndexStore.getState().triggerBuild('unknown-session')
      expect(mockBuildSchemaIndex).not.toHaveBeenCalled()
    })

    it('sets error status when build fails', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockBuildSchemaIndex.mockRejectedValueOnce(new Error('Build failed'))

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(mockGetIndexStatus).toHaveBeenCalled()
      })

      await useSchemaIndexStore.getState().triggerBuild('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('error')
      expect(state.connections['session-1'].error).toBe('Build failed')
    })

    it('updates status to not_configured when backend returns not_configured', async () => {
      mockGetIndexStatus.mockResolvedValue({ status: 'not_configured' })

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(mockGetIndexStatus).toHaveBeenCalledWith('session-1')
      })

      await useSchemaIndexStore.getState().triggerBuild('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('not_configured')
    })
  })

  describe('triggerInvalidation', () => {
    it('calls invalidateSchemaIndex with correct args', async () => {
      await useSchemaIndexStore.getState().triggerInvalidation('session-1', ['db.users'])
      expect(mockInvalidateSchemaIndex).toHaveBeenCalledWith('session-1', ['db.users'])
    })

    it('handles invalidation failure gracefully', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockInvalidateSchemaIndex.mockRejectedValueOnce(new Error('Invalidation failed'))

      await useSchemaIndexStore.getState().triggerInvalidation('session-1', ['db.users'])
      expect(consoleSpy).toHaveBeenCalledWith(
        '[schema-index-store] Failed to invalidate index:',
        'Invalidation failed'
      )
    })
  })

  describe('getStatusForSession', () => {
    it('returns connection index state for registered session', () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')

      const status = useSchemaIndexStore.getState().getStatusForSession('session-1')
      expect(status).toBeDefined()
      expect(status!.status).toBe('stale')
    })

    it('returns undefined for unknown session', () => {
      const status = useSchemaIndexStore.getState().getStatusForSession('unknown')
      expect(status).toBeUndefined()
    })
  })

  describe('_handleProgress / _handleComplete / _handleError with no sessions', () => {
    it('_handleProgress does nothing for unknown profile', () => {
      useSchemaIndexStore.getState()._handleProgress('unknown-profile', 'embedding', 1, 10)
      expect(useSchemaIndexStore.getState().connections).toEqual({})
    })

    it('_handleComplete does nothing for unknown profile', () => {
      useSchemaIndexStore.getState()._handleComplete('unknown-profile')
      expect(useSchemaIndexStore.getState().connections).toEqual({})
    })

    it('_handleError does nothing for unknown profile', () => {
      useSchemaIndexStore.getState()._handleError('unknown-profile', 'some error')
      expect(useSchemaIndexStore.getState().connections).toEqual({})
    })
  })

  describe('settings subscription', () => {
    it('does not trigger rebuild when embedding model has not changed', async () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for async status fetch
      await vi.waitFor(() => {
        expect(mockGetIndexStatus).toHaveBeenCalled()
      })
      mockBuildSchemaIndex.mockClear()

      expect(settingsSubscriber).toBeDefined()

      // Pass the same value that prevEmbeddingModel holds ('' at initialization)
      settingsSubscriber!({
        getSetting: (key: string) => {
          if (key === 'ai.embeddingModel') return currentEmbeddingModel
          return ''
        },
      })

      expect(mockBuildSchemaIndex).not.toHaveBeenCalled()
    })

    it('triggers rebuild for all sessions when embedding model changes', async () => {
      // Register a session to trigger subscription setup
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState().registerSession('session-2', 'profile-2')

      // Wait for async status fetches
      await vi.waitFor(() => {
        expect(mockGetIndexStatus).toHaveBeenCalledTimes(2)
      })

      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(settingsSubscriber).toBeDefined()

      // Simulate embedding model change
      currentEmbeddingModel = 'new-model'
      settingsSubscriber!({
        getSetting: (key: string) => {
          if (key === 'ai.embeddingModel') return 'new-model'
          return ''
        },
      })

      // Wait for async triggerBuild calls to complete
      await vi.waitFor(() => {
        expect(mockBuildSchemaIndex).toHaveBeenCalledWith('session-1')
        expect(mockBuildSchemaIndex).toHaveBeenCalledWith('session-2')
      })
    })

    it('handles rebuild failure during model change gracefully', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockBuildSchemaIndex.mockRejectedValue(new Error('Rebuild failed'))

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')

      // Wait for async status fetch
      await vi.waitFor(() => {
        expect(mockGetIndexStatus).toHaveBeenCalled()
      })

      expect(settingsSubscriber).toBeDefined()

      currentEmbeddingModel = 'another-model'
      settingsSubscriber!({
        getSetting: (key: string) => {
          if (key === 'ai.embeddingModel') return 'another-model'
          return ''
        },
      })

      // Wait for async calls to settle
      await vi.waitFor(() => {
        expect(consoleSpy).toHaveBeenCalled()
      })
    })
  })

  describe('triggerBuild error with non-Error object', () => {
    it('handles non-Error rejection in triggerBuild', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockBuildSchemaIndex.mockRejectedValueOnce('string error')

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(mockGetIndexStatus).toHaveBeenCalled()
      })

      await useSchemaIndexStore.getState().triggerBuild('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('error')
      expect(state.connections['session-1'].error).toBe('string error')
    })
  })

  describe('triggerInvalidation with non-Error object', () => {
    it('handles non-Error rejection in triggerInvalidation', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockInvalidateSchemaIndex.mockRejectedValueOnce('string error')

      await useSchemaIndexStore.getState().triggerInvalidation('session-1', ['db.users'])
      expect(consoleSpy).toHaveBeenCalledWith(
        '[schema-index-store] Failed to invalidate index:',
        'string error'
      )
    })
  })

  describe('forceRebuild', () => {
    it('calls forceRebuildSchemaIndex and sets status to building', async () => {
      mockGetIndexStatus.mockResolvedValueOnce({ status: 'building' })
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(mockGetIndexStatus).toHaveBeenCalledWith('session-1')
      })
      mockGetIndexStatus.mockClear()
      mockGetIndexStatus.mockResolvedValueOnce({ status: 'building' })

      await useSchemaIndexStore.getState().forceRebuild('session-1')

      expect(mockForceRebuildSchemaIndex).toHaveBeenCalledWith('session-1')
      // getIndexStatus should have been called after forceRebuildSchemaIndex
      expect(mockGetIndexStatus).toHaveBeenCalledWith('session-1')
    })

    it('does nothing for unknown session', async () => {
      await useSchemaIndexStore.getState().forceRebuild('unknown-session')
      expect(mockForceRebuildSchemaIndex).not.toHaveBeenCalled()
    })

    it('sets error status when force rebuild fails', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockForceRebuildSchemaIndex.mockRejectedValueOnce(new Error('Force rebuild failed'))

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(mockGetIndexStatus).toHaveBeenCalled()
      })

      await useSchemaIndexStore.getState().forceRebuild('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('error')
      expect(state.connections['session-1'].error).toBe('Force rebuild failed')
    })

    it('handles non-Error rejection in forceRebuild', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockForceRebuildSchemaIndex.mockRejectedValueOnce('string error')

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(mockGetIndexStatus).toHaveBeenCalled()
      })

      await useSchemaIndexStore.getState().forceRebuild('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('error')
      expect(state.connections['session-1'].error).toBe('string error')
    })

    it('updates status to not_configured when backend returns not_configured', async () => {
      mockGetIndexStatus.mockResolvedValue({ status: 'not_configured' })

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(mockGetIndexStatus).toHaveBeenCalledWith('session-1')
      })

      await useSchemaIndexStore.getState().forceRebuild('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('not_configured')
    })
  })
})
