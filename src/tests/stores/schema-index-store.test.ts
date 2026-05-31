import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ipc } from '../ipc-mock'
import { useSchemaIndexStore, _resetSchemaIndexStoreForTest } from '../../stores/schema-index-store'
import { useSettingsStore } from '../../stores/settings-store'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset the store state
  useSchemaIndexStore.setState({
    connections: {},
    profileToSessions: {},
    sessionToProfile: {},
  })
  // Default IPC overrides for schema-index-related commands
  ipc.override('get_index_status', () => ({ status: 'stale' }))
  ipc.override('build_schema_index', () => undefined)
  ipc.override('force_rebuild_schema_index', () => undefined)
  ipc.override('invalidate_schema_index', () => undefined)
})

afterEach(() => {
  _resetSchemaIndexStoreForTest()
})

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
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })
    })

    it('stores multiple sessions for the same profile', () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState().registerSession('session-2', 'profile-1')

      const state = useSchemaIndexStore.getState()
      expect(state.profileToSessions['profile-1']).toEqual(['session-1', 'session-2'])
    })

    it('updates status from backend on registration', async () => {
      ipc.override('get_index_status', () => ({ status: 'ready' }))
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')

      await vi.waitFor(() => {
        const state = useSchemaIndexStore.getState()
        expect(state.connections['session-1'].status).toBe('ready')
      })
    })

    it('handles getIndexStatus failure gracefully on registration', async () => {
      ipc.override('get_index_status', () => {
        throw new Error('Status check failed')
      })
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')

      await vi.waitFor(() => {
        const logCalls = ipc.calls('log_frontend')
        const hasWarning = logCalls.some(
          (call) =>
            (call as Record<string, unknown>)?.level === 'warn' &&
            String((call as Record<string, unknown>)?.message ?? '').includes(
              '[schema-index-store] Failed to get initial index status'
            )
        )
        expect(hasWarning).toBe(true)
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
      ipc.override('get_index_status', () => ({ status: 'building' }))
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })
      ipc.override('get_index_status', () => ({ status: 'building' }))

      await useSchemaIndexStore.getState().triggerBuild('session-1')

      expect(ipc.calls('build_schema_index').length).toBeGreaterThan(0)
      // getIndexStatus should have been called after buildSchemaIndex
      expect(ipc.calls('get_index_status').length).toBeGreaterThan(1)
    })

    it('does nothing for unknown session', async () => {
      await useSchemaIndexStore.getState().triggerBuild('unknown-session')
      expect(ipc.calls('build_schema_index').length).toBe(0)
    })

    it('sets error status when build fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ipc.override('build_schema_index', () => {
        throw new Error('Build failed')
      })

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })

      await useSchemaIndexStore.getState().triggerBuild('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('error')
      expect(state.connections['session-1'].error).toBe('Build failed')
      consoleSpy.mockRestore()
    })

    it('updates status to not_configured when backend returns not_configured', async () => {
      ipc.override('get_index_status', () => ({ status: 'not_configured' }))

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })

      await useSchemaIndexStore.getState().triggerBuild('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('not_configured')
    })

    it('should NOT call buildSchemaIndex for a second session when the same profile already has a completed build', async () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })
      await useSchemaIndexStore.getState().triggerBuild('session-1')
      useSchemaIndexStore.getState()._handleComplete('profile-1')

      // Reset call counters
      const buildCallsBefore = ipc.calls('build_schema_index').length
      const statusCallsBefore = ipc.calls('get_index_status').length

      useSchemaIndexStore.getState().registerSession('session-2', 'profile-1')
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(statusCallsBefore)
      })
      await useSchemaIndexStore.getState().triggerBuild('session-2')
      expect(ipc.calls('build_schema_index').length).toBe(buildCallsBefore)
    })

    it('should NOT call buildSchemaIndex for concurrent sessions to the same profile', async () => {
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState().registerSession('session-2', 'profile-1')
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThanOrEqual(2)
      })

      const buildCallsBefore = ipc.calls('build_schema_index').length
      const p1 = useSchemaIndexStore.getState().triggerBuild('session-1')
      const p2 = useSchemaIndexStore.getState().triggerBuild('session-2')
      await Promise.all([p1, p2])
      expect(ipc.calls('build_schema_index').length).toBe(buildCallsBefore + 1)
    })
  })

  describe('triggerInvalidation', () => {
    it('calls invalidateSchemaIndex with correct args', async () => {
      await useSchemaIndexStore.getState().triggerInvalidation('session-1', ['db.users'])
      const invalidateCalls = ipc.calls('invalidate_schema_index')
      expect(invalidateCalls.length).toBeGreaterThan(0)
      const lastCall = invalidateCalls[invalidateCalls.length - 1] as Record<string, unknown>
      expect(lastCall?.sessionId).toBe('session-1')
      expect(lastCall?.tables).toEqual(['db.users'])
    })

    it('handles invalidation failure gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ipc.override('invalidate_schema_index', () => {
        throw new Error('Invalidation failed')
      })

      await useSchemaIndexStore.getState().triggerInvalidation('session-1', ['db.users'])
      expect(consoleSpy).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
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
      // Set initial embedding model
      useSettingsStore.setState({ settings: { 'ai.embeddingModel': '' } } as never)

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for async status fetch
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })

      const buildCallsBefore = ipc.calls('build_schema_index').length

      // Set the same value — should NOT trigger a rebuild
      useSettingsStore.setState({ settings: { 'ai.embeddingModel': '' } } as never)

      // Give subscription time to fire
      await new Promise((r) => setTimeout(r, 20))

      expect(ipc.calls('build_schema_index').length).toBe(buildCallsBefore)
    })

    it('triggers rebuild for all sessions when embedding model changes', async () => {
      // Set initial embedding model
      useSettingsStore.setState({ settings: { 'ai.embeddingModel': '' } } as never)

      // Register a session to trigger subscription setup
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState().registerSession('session-2', 'profile-2')

      // Wait for async status fetches
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThanOrEqual(2)
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const buildCallsBefore = ipc.calls('build_schema_index').length

      // Simulate embedding model change
      useSettingsStore.setState({ settings: { 'ai.embeddingModel': 'new-model' } } as never)

      // Wait for async triggerBuild calls to complete
      await vi.waitFor(() => {
        // Both sessions should have triggered a build
        expect(ipc.calls('build_schema_index').length).toBeGreaterThanOrEqual(buildCallsBefore + 2)
      })
      consoleSpy.mockRestore()
    })

    it('cleans up subscription on last unregister and re-establishes on next register', async () => {
      useSettingsStore.setState({ settings: { 'ai.embeddingModel': '' } } as never)

      // Register and then unregister — subscription should be cleaned up
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })
      useSchemaIndexStore.getState().unregisterSession('session-1')

      // A model change now should NOT trigger a build (no subscription)
      const buildCallsBefore = ipc.calls('build_schema_index').length
      useSettingsStore.setState({ settings: { 'ai.embeddingModel': 'model-a' } } as never)
      await new Promise((r) => setTimeout(r, 20))
      expect(ipc.calls('build_schema_index').length).toBe(buildCallsBefore)

      // Re-register — subscription should be re-established
      useSchemaIndexStore.getState().registerSession('session-2', 'profile-2')
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThanOrEqual(2)
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Now a model change SHOULD trigger a build
      const buildCallsBefore2 = ipc.calls('build_schema_index').length
      useSettingsStore.setState({ settings: { 'ai.embeddingModel': 'model-b' } } as never)
      await vi.waitFor(() => {
        expect(ipc.calls('build_schema_index').length).toBeGreaterThan(buildCallsBefore2)
      })
      consoleSpy.mockRestore()
    })

    it('keeps subscription active when sessions remain after partial unregister', async () => {
      useSettingsStore.setState({ settings: { 'ai.embeddingModel': '' } } as never)

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      useSchemaIndexStore.getState().registerSession('session-2', 'profile-2')
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThanOrEqual(2)
      })

      // Unregister one — subscription should still be alive
      useSchemaIndexStore.getState().unregisterSession('session-1')

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const buildCallsBefore = ipc.calls('build_schema_index').length
      useSettingsStore.setState({ settings: { 'ai.embeddingModel': 'changed-model' } } as never)
      await vi.waitFor(() => {
        expect(ipc.calls('build_schema_index').length).toBeGreaterThan(buildCallsBefore)
      })
      consoleSpy.mockRestore()
    })

    it('handles rebuild failure during model change gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ipc.override('build_schema_index', () => {
        throw new Error('Rebuild failed')
      })

      useSettingsStore.setState({ settings: { 'ai.embeddingModel': '' } } as never)
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')

      // Wait for async status fetch
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })

      // Simulate embedding model change
      useSettingsStore.setState({ settings: { 'ai.embeddingModel': 'another-model' } } as never)

      // Wait for async calls to settle (error should be caught)
      await new Promise((r) => setTimeout(r, 50))
      expect(consoleSpy).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('triggerBuild error with non-Error object', () => {
    it('handles non-Error rejection in triggerBuild', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ipc.override('build_schema_index', () => {
        throw 'string error'
      })

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })

      await useSchemaIndexStore.getState().triggerBuild('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('error')
      expect(state.connections['session-1'].error).toBe('string error')
      consoleSpy.mockRestore()
    })
  })

  describe('triggerInvalidation with non-Error object', () => {
    it('handles non-Error rejection in triggerInvalidation', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ipc.override('invalidate_schema_index', () => {
        throw 'string error'
      })

      await useSchemaIndexStore.getState().triggerInvalidation('session-1', ['db.users'])
      expect(consoleSpy).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('forceRebuild', () => {
    it('calls forceRebuildSchemaIndex and checks status after', async () => {
      ipc.override('get_index_status', () => ({ status: 'building' }))
      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })
      ipc.override('get_index_status', () => ({ status: 'building' }))

      await useSchemaIndexStore.getState().forceRebuild('session-1')

      expect(ipc.calls('force_rebuild_schema_index').length).toBeGreaterThan(0)
      // getIndexStatus should have been called after forceRebuildSchemaIndex
      expect(ipc.calls('get_index_status').length).toBeGreaterThan(1)
    })

    it('does nothing for unknown session', async () => {
      await useSchemaIndexStore.getState().forceRebuild('unknown-session')
      expect(ipc.calls('force_rebuild_schema_index').length).toBe(0)
    })

    it('sets error status when force rebuild fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ipc.override('force_rebuild_schema_index', () => {
        throw new Error('Force rebuild failed')
      })

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })

      await useSchemaIndexStore.getState().forceRebuild('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('error')
      expect(state.connections['session-1'].error).toBe('Force rebuild failed')
      consoleSpy.mockRestore()
    })

    it('handles non-Error rejection in forceRebuild', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ipc.override('force_rebuild_schema_index', () => {
        throw 'string error'
      })

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })

      await useSchemaIndexStore.getState().forceRebuild('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('error')
      expect(state.connections['session-1'].error).toBe('string error')
      consoleSpy.mockRestore()
    })

    it('updates status to not_configured when backend returns not_configured', async () => {
      ipc.override('get_index_status', () => ({ status: 'not_configured' }))

      useSchemaIndexStore.getState().registerSession('session-1', 'profile-1')
      // Wait for registerSession's async getIndexStatus call to settle
      await vi.waitFor(() => {
        expect(ipc.calls('get_index_status').length).toBeGreaterThan(0)
      })

      await useSchemaIndexStore.getState().forceRebuild('session-1')

      const state = useSchemaIndexStore.getState()
      expect(state.connections['session-1'].status).toBe('not_configured')
    })
  })
})
