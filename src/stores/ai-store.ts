import { create } from 'zustand'
import { logFrontend } from '../lib/app-log-commands'
import { sendAiChat, cancelAiStream, listenToAiStream } from '../lib/ai-commands'
import type { AiMessage as IpcAiMessage } from '../lib/ai-commands'
import { compactSchemaDdl } from '../lib/schema-ddl-compactor'
import type { SchemaCompactionResult } from '../lib/schema-ddl-compactor'
// Cross-layer import: schema-metadata-cache lives in components/ but is a
// module-level singleton, not a React component. Accepted as a pragmatic
// trade-off to avoid duplicating cache-loading logic.
import { loadCache, getCache } from '../components/query-editor/schema-metadata-cache'
import { useSettingsStore } from './settings-store'
import { useQueryStore } from './query-store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface AttachedContext {
  sql: string
  range: {
    startLineNumber: number
    endLineNumber: number
    startColumn: number
    endColumn: number
  }
}

export interface TabAiState {
  messages: AiMessage[]
  isGenerating: boolean
  activeStreamId: string | null
  attachedContext: AttachedContext | null
  isPanelOpen: boolean
  error: string | null
  schemaDdl: string | null
  schemaTokenCount: number
  schemaWarning: boolean
  /** Connection ID associated with this tab — needed for cross-store status management. */
  connectionId: string | null
  _unlisten: (() => void) | null
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function createDefaultTabAiState(): TabAiState {
  return {
    messages: [],
    isGenerating: false,
    activeStreamId: null,
    attachedContext: null,
    isPanelOpen: false,
    error: null,
    schemaDdl: null,
    schemaTokenCount: 0,
    schemaWarning: false,
    connectionId: null,
    _unlisten: null,
  }
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface AiState {
  tabs: Record<string, TabAiState>

  // Message actions
  sendMessage: (
    tabId: string,
    connectionId: string,
    message: string,
    settings: { temperature?: number; maxTokens?: number; model?: string }
  ) => void
  cancelStream: (tabId: string) => void
  retryLastMessage: (
    tabId: string,
    connectionId: string,
    settings: { temperature?: number; maxTokens?: number; model?: string }
  ) => void

  // Stream lifecycle
  onStreamChunk: (tabId: string, streamId: string, content: string) => void
  onStreamDone: (tabId: string, streamId: string) => void
  onStreamError: (tabId: string, streamId: string, error: string) => void
  setUnlisten: (tabId: string, unlisten: () => void) => void

  // Panel actions
  togglePanel: (tabId: string) => void
  openPanel: (tabId: string) => void
  closePanel: (tabId: string) => void

  // Context actions
  setAttachedContext: (tabId: string, context: AttachedContext) => void
  clearAttachedContext: (tabId: string) => void

  // Conversation management
  clearConversation: (tabId: string) => void
  setError: (tabId: string, error: string) => void
  clearError: (tabId: string) => void

  // Schema context
  setSchemaContext: (tabId: string, ddl: string, tokenCount: number, warning: boolean) => void
  /** Pre-load schema DDL and populate token count so it's visible before the first send. */
  preloadSchemaContext: (tabId: string, connectionId: string) => void

  // Editor lock — AI status management
  /** Lock the editor in 'ai-reviewing' state (e.g. while a diff overlay is open). */
  setAiReviewing: (tabId: string) => void
  /** Restore the query tab status from prevTabStatus after an AI lock. */
  restoreTabStatus: (tabId: string) => void

  // Cleanup
  cleanupTab: (tabId: string) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed system prompt describing the AI assistant's capabilities. */
const AI_SYSTEM_PROMPT = `You are an expert SQL assistant integrated into a database client. You help users:
- Write SQL queries from natural language descriptions
- Explain what existing SQL queries do
- Optimize queries for better performance
- Debug SQL issues and suggest fixes
- Answer general SQL and database questions

You have access to the current database schema below. Always write SQL that is compatible with MySQL/MariaDB syntax.

When writing SQL, prefer clear, readable queries. Format your SQL code in markdown code blocks with the sql language tag.`

/** Note appended when schema DDL is provided to inform the AI of omitted metadata. */
const SCHEMA_METADATA_NOTE = 'Note: Cardinality statistics are omitted from index metadata.'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAiStore = create<AiState>()((set, get) => {
  /** Get or lazily initialize tab state. */
  const ensureTab = (tabId: string): TabAiState => {
    const existing = get().tabs[tabId]
    if (existing) return existing
    const fresh = createDefaultTabAiState()
    set((state) => ({
      tabs: { ...state.tabs, [tabId]: fresh },
    }))
    return fresh
  }

  /** Merge a partial update into a single tab's AI state. */
  const patchTab = (tabId: string, partial: Partial<TabAiState>) => {
    set((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: { ...(state.tabs[tabId] ?? createDefaultTabAiState()), ...partial },
      },
    }))
  }

  /** Safely invoke and clear the unlisten callback for a tab's event listener. */
  function callUnlistenSafely(tabId: string, tab: TabAiState | undefined): void {
    if (tab?._unlisten) {
      try {
        tab._unlisten()
      } catch {
        // Swallow — listener cleanup is best-effort
      }
      patchTab(tabId, { _unlisten: null })
    }
  }

  /**
   * Prepend a system message to the tab's conversation if one doesn't already exist.
   * Returns true if a system message was added.
   */
  function ensureSystemMessage(tabId: string, systemContent: string): boolean {
    const currentTab = get().tabs[tabId]
    if (currentTab?.messages.some((m) => m.role === 'system')) return false
    const systemMessage: AiMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content: systemContent,
      timestamp: Date.now(),
    }
    patchTab(tabId, {
      messages: [systemMessage, ...get().tabs[tabId]!.messages],
    })
    return true
  }

  /**
   * Build a system message containing the compact schema DDL for a connection.
   * Loads the schema cache if needed, then compacts the metadata.
   */
  const buildSchemaSystemMessage = async (
    connectionId: string
  ): Promise<{ message: AiMessage; compaction: SchemaCompactionResult } | null> => {
    try {
      await loadCache(connectionId)
      const cache = getCache(connectionId)

      if (cache.status !== 'ready') {
        return null
      }

      if (Object.keys(cache.tables).length === 0) {
        return null
      }

      const compaction = compactSchemaDdl(
        cache.tables,
        cache.columns,
        cache.foreignKeys,
        cache.indexes
      )

      const systemMessage: AiMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `${AI_SYSTEM_PROMPT}\n\n${SCHEMA_METADATA_NOTE}\n\nDatabase schema:\n${compaction.ddl}`,
        timestamp: Date.now(),
      }

      return { message: systemMessage, compaction }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[ai-store] Failed to build schema system message:', errorMsg)
      logFrontend('error', `[ai-store] Schema loading failed: ${errorMsg}`)
      return null
    }
  }

  return {
    tabs: {},

    // ------ sendMessage ------

    sendMessage: (tabId, connectionId, message, settings) => {
      ensureTab(tabId)

      const tab = get().tabs[tabId]!
      const isFirstMessage = tab.messages.length === 0
      const streamId = crypto.randomUUID()

      const userMessage: AiMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
      }

      // Capture attached context before async work begins
      const attachedContext = tab.attachedContext

      // Add the user message immediately and store connectionId
      patchTab(tabId, {
        messages: [...tab.messages, userMessage],
        error: null,
        isGenerating: true,
        activeStreamId: streamId,
        connectionId,
      })

      // NOTE: Do NOT clear attachedContext here. It must remain set so that
      // the "Review Diff" button in AI code blocks stays visible when the
      // streaming response arrives. It is cleared explicitly by the user
      // (clearAttachedContext) or when the diff overlay is dismissed.

      // Lock the editor while AI is generating
      useQueryStore.getState().setTabStatus(tabId, 'ai-pending')

      // Async IPC flow — fire-and-forget from the synchronous action
      const startStream = async () => {
        try {
          // If this is the first user message, try to build a schema system message
          let schemaResult: { message: AiMessage; compaction: SchemaCompactionResult } | null = null
          if (isFirstMessage) {
            schemaResult = await buildSchemaSystemMessage(connectionId)
            if (!get().tabs[tabId]) return // tab was cleaned up while waiting

            // Guard: schema loading is async; abort if stream was cancelled before we got here
            if (
              get().tabs[tabId]?.activeStreamId !== streamId ||
              !get().tabs[tabId]?.isGenerating
            ) {
              return
            }

            if (schemaResult) {
              ensureSystemMessage(
                tabId,
                `${AI_SYSTEM_PROMPT}\n\n${SCHEMA_METADATA_NOTE}\n\nDatabase schema:\n${schemaResult.compaction.ddl}`
              )
              patchTab(tabId, {
                schemaDdl: schemaResult.compaction.ddl,
                schemaTokenCount: schemaResult.compaction.estimatedTokens,
                schemaWarning: schemaResult.compaction.warning,
              })
            } else {
              // No schema available — inject a system prompt without schema DDL
              ensureSystemMessage(tabId, AI_SYSTEM_PROMPT)
            }
          }

          if (!get().tabs[tabId]) return // tab was cleaned up

          // Set up event listeners for this stream
          const unlisten = await listenToAiStream(streamId, {
            onChunk: (content) => get().onStreamChunk(tabId, streamId, content),
            onDone: () => get().onStreamDone(tabId, streamId),
            onError: (error) => get().onStreamError(tabId, streamId, error),
          })

          if (!get().tabs[tabId]) {
            unlisten()
            return
          }

          // Guard: listener setup is async; abort if stream was cancelled in the meantime
          if (get().tabs[tabId]?.activeStreamId !== streamId || !get().tabs[tabId]?.isGenerating) {
            unlisten()
            return
          }

          get().setUnlisten(tabId, unlisten)

          // Read AI settings from the settings store
          const getSetting = useSettingsStore.getState().getSetting
          const endpoint = getSetting('ai.endpoint')
          const model = settings.model ?? getSetting('ai.model')
          const temperature = settings.temperature ?? parseFloat(getSetting('ai.temperature'))
          const maxTokens = settings.maxTokens ?? parseInt(getSetting('ai.maxTokens'), 10)

          // Build IPC messages from the current conversation
          const currentMessages = get().tabs[tabId]?.messages ?? []
          const ipcMessages: IpcAiMessage[] = currentMessages.map((m) => ({
            role: m.role,
            content: m.content,
          }))

          // Inject attached SQL context as a separate message before the user's prompt
          if (attachedContext) {
            const contextMessage: IpcAiMessage = {
              role: 'user',
              content: `The following SQL statement is the context for this conversation:\n\n\`\`\`sql\n${attachedContext.sql}\n\`\`\``,
            }
            // Insert the context message just before the last user message
            const lastUserIdx = ipcMessages.length - 1
            ipcMessages.splice(lastUserIdx, 0, contextMessage)
          }

          // Start the stream
          await sendAiChat({
            messages: ipcMessages,
            endpoint,
            model,
            temperature: isNaN(temperature) ? 0.3 : temperature,
            maxTokens: isNaN(maxTokens) ? 2048 : maxTokens,
            streamId,
          })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          console.error('[ai-store] Failed to start AI chat stream:', errorMsg)
          logFrontend('error', `[ai-store] AI chat failed: ${errorMsg}`)

          if (get().tabs[tabId]) {
            // Clean up orphaned event listeners before resetting state
            callUnlistenSafely(tabId, get().tabs[tabId])

            patchTab(tabId, {
              isGenerating: false,
              activeStreamId: null,
              error: errorMsg,
            })
            // Restore the editor lock on failure
            get().restoreTabStatus(tabId)
          }
        }
      }

      startStream()
    },

    // ------ cancelStream ------

    cancelStream: (tabId) => {
      ensureTab(tabId)
      const tab = get().tabs[tabId]!
      const streamId = tab.activeStreamId
      if (!streamId) return

      // Update state immediately
      patchTab(tabId, {
        isGenerating: false,
        activeStreamId: null,
      })

      // Restore the editor lock
      get().restoreTabStatus(tabId)

      // Clean up event listeners
      callUnlistenSafely(tabId, tab)

      // Cancel the backend stream (fire-and-forget)
      cancelAiStream(streamId).catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error('[ai-store] Failed to cancel AI stream:', errorMsg)
        logFrontend('warn', `[ai-store] AI cancel failed: ${errorMsg}`)
      })
    },

    // ------ retryLastMessage ------

    retryLastMessage: (tabId, connectionId, settings) => {
      const tab = get().tabs[tabId]
      if (!tab) return

      // Find the last user message
      const lastUserMessage = [...tab.messages].reverse().find((m) => m.role === 'user')
      if (!lastUserMessage) return

      // Remove the last user message and any assistant messages after it
      const lastUserIndex = tab.messages.lastIndexOf(lastUserMessage)
      const messagesUpToLastUser = tab.messages.slice(0, lastUserIndex)

      patchTab(tabId, {
        messages: messagesUpToLastUser,
        error: null,
      })

      // Re-send the message
      get().sendMessage(tabId, connectionId, lastUserMessage.content, settings)
    },

    // ------ onStreamChunk ------

    onStreamChunk: (tabId, streamId, content) => {
      // Stale-stream guard: ignore events from a previous stream that was superseded
      const tab = get().tabs[tabId]
      if (!tab || tab.activeStreamId !== streamId) return

      const messages = [...tab.messages]
      const lastMessage = messages[messages.length - 1]

      if (lastMessage && lastMessage.role === 'assistant') {
        // Append to existing assistant message
        messages[messages.length - 1] = {
          ...lastMessage,
          content: lastMessage.content + content,
        }
      } else {
        // Create a new assistant message
        messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content,
          timestamp: Date.now(),
        })
      }

      patchTab(tabId, {
        messages,
        isGenerating: true,
        activeStreamId: streamId,
      })
    },

    // ------ onStreamDone ------

    onStreamDone: (tabId, streamId) => {
      // Stale-stream guard: ignore events from a previous stream that was superseded
      const tab = get().tabs[tabId]
      if (!tab || tab.activeStreamId !== streamId) return

      patchTab(tabId, {
        isGenerating: false,
        activeStreamId: null,
      })

      // Tear down event listeners now that the stream is complete
      callUnlistenSafely(tabId, tab)

      // Restore the editor — generation is complete
      get().restoreTabStatus(tabId)
    },

    // ------ onStreamError ------

    onStreamError: (tabId, streamId, error) => {
      // Stale-stream guard: ignore events from a previous stream that was superseded
      const tab = get().tabs[tabId]
      if (!tab || tab.activeStreamId !== streamId) return

      patchTab(tabId, {
        isGenerating: false,
        error,
        activeStreamId: null,
      })

      // Tear down event listeners now that the stream has errored
      callUnlistenSafely(tabId, tab)

      // Restore the editor — generation failed
      get().restoreTabStatus(tabId)
    },

    // ------ setUnlisten ------

    setUnlisten: (tabId, unlisten) => {
      ensureTab(tabId)
      patchTab(tabId, { _unlisten: unlisten })
    },

    // ------ togglePanel ------

    togglePanel: (tabId) => {
      ensureTab(tabId)
      const tab = get().tabs[tabId]!
      patchTab(tabId, { isPanelOpen: !tab.isPanelOpen })
    },

    // ------ openPanel ------

    openPanel: (tabId) => {
      ensureTab(tabId)
      patchTab(tabId, { isPanelOpen: true })
    },

    // ------ closePanel ------

    closePanel: (tabId) => {
      ensureTab(tabId)
      patchTab(tabId, { isPanelOpen: false })
    },

    // ------ setAttachedContext ------

    setAttachedContext: (tabId, context) => {
      ensureTab(tabId)
      patchTab(tabId, { attachedContext: context })
    },

    // ------ clearAttachedContext ------

    clearAttachedContext: (tabId) => {
      ensureTab(tabId)
      patchTab(tabId, { attachedContext: null })
    },

    // ------ clearConversation ------

    clearConversation: (tabId) => {
      ensureTab(tabId)
      patchTab(tabId, {
        messages: [],
        error: null,
      })
    },

    // ------ setError ------

    setError: (tabId, error) => {
      ensureTab(tabId)
      patchTab(tabId, { error })
    },

    // ------ clearError ------

    clearError: (tabId) => {
      ensureTab(tabId)
      patchTab(tabId, { error: null })
    },

    // ------ setSchemaContext ------

    setSchemaContext: (tabId, ddl, tokenCount, warning) => {
      ensureTab(tabId)
      patchTab(tabId, {
        schemaDdl: ddl,
        schemaTokenCount: tokenCount,
        schemaWarning: warning,
      })
    },

    // ------ preloadSchemaContext ------

    preloadSchemaContext: (tabId, connectionId) => {
      ensureTab(tabId)

      // Skip if already loaded
      const tab = get().tabs[tabId]
      if (tab && tab.schemaTokenCount > 0) return

      // Fire-and-forget — do not block the panel from opening
      buildSchemaSystemMessage(connectionId)
        .then((result) => {
          if (!result) return
          // Only update if the tab still exists and hasn't been populated yet
          const current = get().tabs[tabId]
          if (current && current.schemaTokenCount === 0) {
            patchTab(tabId, {
              schemaDdl: result.compaction.ddl,
              schemaTokenCount: result.compaction.estimatedTokens,
              schemaWarning: result.compaction.warning,
            })
          }
        })
        .catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err)
          console.error('[ai-store] Failed to preload schema context:', errorMsg)
          logFrontend('warn', `[ai-store] Schema preload failed: ${errorMsg}`)
        })
    },

    // ------ setAiReviewing ------

    setAiReviewing: (tabId) => {
      useQueryStore.getState().setTabStatus(tabId, 'ai-reviewing')
    },

    // ------ restoreTabStatus ------

    restoreTabStatus: (tabId) => {
      const queryTab = useQueryStore.getState().tabs[tabId]
      if (!queryTab) return

      // Only restore if the tab is currently in an AI lock state
      const { tabStatus, prevTabStatus } = queryTab
      if (tabStatus === 'ai-pending' || tabStatus === 'ai-reviewing') {
        useQueryStore.getState().setTabStatus(tabId, prevTabStatus)
      }
    },

    // ------ cleanupTab ------

    cleanupTab: (tabId) => {
      const tab = get().tabs[tabId]

      // Cancel any in-flight AI request before tearing down the tab
      if (tab?.activeStreamId) {
        cancelAiStream(tab.activeStreamId).catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err)
          console.error('[ai-store] Failed to cancel AI stream during cleanup:', errorMsg)
          logFrontend(
            'warn',
            `[ai-store] AI cancel during cleanup for tab ${tabId} failed: ${errorMsg}`
          )
        })
      }

      if (tab?._unlisten) {
        try {
          tab._unlisten()
        } catch (err) {
          console.error('[ai-store] Error calling unlisten during cleanup:', err)
          logFrontend(
            'warn',
            `[ai-store] Error calling unlisten for tab ${tabId}: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }

      set((state) => {
        const newTabs = { ...state.tabs }
        delete newTabs[tabId]
        return { tabs: newTabs }
      })
    },
  }
})
