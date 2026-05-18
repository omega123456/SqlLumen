/**
 * Shared AI test helpers.
 *
 * Import `makeAiTabState` instead of defining a local `emptyTabState`/`emptyAiTabState`
 * in each test file.
 */
import type { TabAiState } from '../../stores/ai-store'

/**
 * Build a `TabAiState` with all fields set to safe defaults.
 *
 * - `isPanelOpen` defaults to `false`. Tests that need the panel open should
 *   pass `{ isPanelOpen: true }` via the `overrides` argument.
 */
export function makeAiTabState(overrides?: Partial<TabAiState>): TabAiState {
  return {
    messages: [],
    isGenerating: false,
    activeStreamId: null,
    previousResponseId: null,
    attachedContext: null,
    isPanelOpen: false,
    error: null,
    providedChunkKeys: {},
    cumulativeSchemaTokens: 0,
    providedMemoryIds: {},
    lastCompletedSystemPrompt: '',
    lastCompletedTransport: null,
    lastCompletedEndpoint: '',
    lastCompletedModel: '',
    activeRequestEndpoint: '',
    activeRequestModel: '',
    activeStreamHasAssistantOutput: false,
    isWaitingForIndex: false,
    connectionId: null,
    _unlisten: null,
    ...overrides,
  }
}
