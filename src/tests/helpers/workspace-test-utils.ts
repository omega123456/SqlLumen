/**
 * Shared strict-visibility workspace test utilities.
 *
 * Zustand `setState` performs a shallow merge: fields omitted from a partial
 * update keep their previous value. When tests reset only a subset of the
 * workspace lifecycle fields, omitted fields (including the strict
 * `visibleConnectionSessionId`) can leak between tests.
 *
 * Use {@link resetWorkspaceStore} in `beforeEach` to clear the complete
 * workspace lifecycle state, and optionally seed a globally visible connection
 * when the scenario requires visible-surface behavior. Empty-state tests should
 * call it with no visible session so strict production semantics stay
 * accurately represented.
 */
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../stores/workspace-store'

/**
 * Options for {@link resetWorkspaceStore}.
 */
export interface ResetWorkspaceStoreOptions {
  /**
   * Runtime connection-session ID to seed as the globally visible connection.
   *
   * Defaults to an empty string, representing no globally visible connection
   * (welcome state). Seed a value only for scenarios that require an active,
   * visible workspace.
   */
  visibleConnectionSessionId?: string

  /**
   * Whether to reset the tab ID and query tab ID counters. Defaults to `true`
   * so successive tests produce deterministic generated tab IDs.
   */
  resetCounters?: boolean
}

/**
 * Reset the complete workspace lifecycle state.
 *
 * Clears every workspace store field — including `visibleConnectionSessionId`
 * — so no lifecycle state leaks between tests through Zustand's shallow merge.
 */
export function resetWorkspaceStore(options: ResetWorkspaceStoreOptions = {}): void {
  const { visibleConnectionSessionId = '', resetCounters = true } = options

  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
    visibleConnectionSessionId,
    stackRecencyByConnection: {},
    lastFocusedSurfaceByTab: {},
    blockingNavigationByTab: {},
    pendingCascadeClose: null,
  })

  if (resetCounters) {
    _resetTabIdCounter()
    _resetQueryTabCounter()
  }
}

/**
 * Seed the globally visible connection-session ID without otherwise resetting
 * the workspace store. Use after {@link resetWorkspaceStore} when a test seeds
 * tabs first and then marks a connection visible.
 */
export function seedVisibleConnection(visibleConnectionSessionId: string): void {
  useWorkspaceStore.setState({ visibleConnectionSessionId })
}
