import { create } from 'zustand'
import { logFrontend } from '../lib/app-log-commands'
import { sendAiChat, cancelAiStream, listenToAiStream, aiQueryExpand } from '../lib/ai-commands'
import type { AiMessage as IpcAiMessage } from '../lib/ai-commands'
import { semanticSearch } from '../lib/schema-index-commands'
import { useSchemaIndexStore } from './schema-index-store'
import { useSettingsStore } from './settings-store'
import { useQueryStore } from './query-store'
import { showErrorToast } from './toast-store'

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
  /** DDL retrieved from vector search for the current retrieval. */
  retrievedSchemaDdl: string
  /** Timestamp of the last successful schema retrieval. */
  lastRetrievalTimestamp: number
  /** True while waiting for the schema index to finish building. */
  isWaitingForIndex: boolean
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
    retrievedSchemaDdl: '',
    lastRetrievalTimestamp: 0,
    isWaitingForIndex: false,
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

Use ONLY tables that appear in the retrieved schema context. Never invent, infer, assume, or reference tables that were not retrieved by semantic search.

Whenever you reference a table in generated SQL, always use its full database-qualified name (for example, \`database_name\`.\`table_name\`).

When writing SQL, prefer clear, readable queries. Format your SQL code in markdown code blocks with the sql language tag.`

/** Note appended when schema DDL is provided to inform the AI of omitted metadata. */
const SCHEMA_METADATA_NOTE = 'Note: Cardinality statistics are omitted from index metadata.'

/** Query expansion system prompt for generating semantic search queries. */
const QUERY_EXPANSION_SYSTEM_PROMPT = `You are a SQL schema search assistant. Given a user's natural language question about a database, generate exactly 3 short search queries that use SQL vocabulary (table names, column names, SQL keywords, JOIN patterns) to find the most relevant database tables. Think about which tables, columns, and relationships would be needed to answer the question. Output strictly as JSON with no explanation.

When table names are mentioned or implied, prefer database-qualified names when possible so retrieval preserves the database prefix.
Format: {"queries":["...","...","..."]}

Examples:
User: "Show me all customers who haven't ordered anything in the last 6 months"
Output: {"queries":["customers orders LEFT JOIN last_order_date","customers table id name email","orders customer_id created_at date"]}

User: "What's the total revenue by product category?"
Output: {"queries":["products categories revenue SUM price","product_categories category_name JOIN products","orders order_items products price quantity amount"]}

User: "List employees and their department managers"
Output: {"queries":["employees departments manager_id supervisor","employees table id name department_id","departments manager employee hierarchy"]}`

const SCHEMA_USAGE_INSTRUCTION = `Retrieved tables only:\n- Use only tables that are present in the retrieved schema below.\n- Never make up or reference any table that is not in the retrieved schema.\n- Always use database-qualified table names in generated SQL (\`db\`.\`table\`).`

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
   * Replace or insert the system message in the tab's conversation.
   * If a system message already exists, update its content.
   * If not, prepend a new one.
   */
  function upsertSystemMessage(tabId: string, systemContent: string): void {
    const currentTab = get().tabs[tabId]
    if (!currentTab) return

    const existingIdx = currentTab.messages.findIndex((m) => m.role === 'system')
    if (existingIdx >= 0) {
      // Update existing system message content (replace, not stack)
      const updatedMessages = [...currentTab.messages]
      updatedMessages[existingIdx] = {
        ...updatedMessages[existingIdx],
        content: systemContent,
        timestamp: Date.now(),
      }
      patchTab(tabId, { messages: updatedMessages })
    } else {
      // Prepend new system message
      const systemMessage: AiMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: systemContent,
        timestamp: Date.now(),
      }
      patchTab(tabId, {
        messages: [systemMessage, ...currentTab.messages],
      })
    }
  }

  /**
   * Retrieve schema context via the vector retrieval pipeline.
   *
   * 1. Wait for schema index if building
   * 2. Expand user query into 3 search queries via aiQueryExpand
   * 3. Perform semantic search
   * 4. Assemble DDL context from results
   */
  async function retrieveSchemaContext(
    tabId: string,
    sessionId: string,
    userMessage: string
  ): Promise<string> {
    try {
      logFrontend(
        'debug',
        `[ai-store] retrieveSchemaContext start — tabId=${tabId} sessionId=${sessionId} userQuery="${userMessage}"`
      )

      // Check index status — if building, wait for it
      const indexState = useSchemaIndexStore.getState().getStatusForSession(sessionId)
      logFrontend(
        'debug',
        `[ai-store] schema index status for session=${sessionId}: ${indexState?.status ?? 'unknown'}`
      )

      if (indexState?.status === 'building') {
        logFrontend('debug', `[ai-store] index is building — waiting (tabId=${tabId})`)
        if (get().tabs[tabId]) {
          patchTab(tabId, { isWaitingForIndex: true })
        }

        // Poll until index is no longer building (max ~30s)
        const maxWaitMs = 30000
        const pollIntervalMs = 500
        let waited = 0
        while (waited < maxWaitMs) {
          await new Promise((r) => setTimeout(r, pollIntervalMs))
          waited += pollIntervalMs
          const current = useSchemaIndexStore.getState().getStatusForSession(sessionId)
          if (!current || current.status !== 'building') break
        }

        const postWaitStatus = useSchemaIndexStore.getState().getStatusForSession(sessionId)
        logFrontend(
          'debug',
          `[ai-store] done waiting for index — waited=${waited}ms finalStatus=${postWaitStatus?.status ?? 'unknown'}`
        )
        patchTab(tabId, { isWaitingForIndex: false })
        if (!get().tabs[tabId]) return ''
      }

      // Query expansion — get 3 search queries
      let queries: string[] = [userMessage]
      try {
        const getSetting = useSettingsStore.getState().getSetting
        const endpoint = getSetting('ai.endpoint')
        const model = getSetting('ai.model')

        logFrontend(
          'debug',
          `[ai-store] query expansion — endpoint=${endpoint ? '[set]' : '[unset]'} model=${model || '[unset]'}`
        )

        if (endpoint && model) {
          const result = await aiQueryExpand({
            endpoint,
            model,
            systemPrompt: QUERY_EXPANSION_SYSTEM_PROMPT,
            userMessage,
          })

          logFrontend('debug', `[ai-store] query expansion raw response: ${result.text}`)

          // Parse JSON response
          const parsed = JSON.parse(result.text)
          if (
            parsed &&
            Array.isArray(parsed.queries) &&
            parsed.queries.length > 0 &&
            parsed.queries.every((q: unknown) => typeof q === 'string')
          ) {
            const normalizedExpandedQueries = parsed.queries
              .map((query: string) => query.trim())
              .filter((query: string) => query.length > 0)

            queries = Array.from(new Set([userMessage, ...normalizedExpandedQueries])).slice(0, 4)
            logFrontend(
              'debug',
              `[ai-store] query expansion succeeded — transformedQueries=${JSON.stringify(queries)}`
            )
          } else {
            logFrontend(
              'debug',
              `[ai-store] query expansion response did not contain valid queries array — falling back to original message`
            )
          }
        } else {
          logFrontend(
            'debug',
            `[ai-store] query expansion skipped — missing endpoint or model, using original user query`
          )
        }
      } catch (err) {
        // Query expansion failed — fall back to original message
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[ai-store] Query expansion failed, using original message:', msg)
        logFrontend('warn', `[ai-store] Query expansion fallback: ${msg}`)
        logFrontend('debug', `[ai-store] falling back to original query: "${userMessage}"`)
      }

      logFrontend(
        'debug',
        `[ai-store] invoking semantic search — sessionId=${sessionId} queryCount=${queries.length} queries=${JSON.stringify(queries)}`
      )

      // Semantic search
      const results = await semanticSearch(sessionId, queries)

      logFrontend(
        'debug',
        `[ai-store] semantic search returned ${results.length} result(s): ${JSON.stringify(
          results.map((r) => ({
            chunkKey: r.chunkKey,
            dbName: r.dbName,
            tableName: r.tableName,
            chunkType: r.chunkType,
            score: r.score,
          }))
        )}`
      )

      // Assemble DDL from results (deduplicate by chunkKey)
      const seen = new Set<string>()
      const ddlParts: string[] = []
      for (const result of results) {
        if (!seen.has(result.chunkKey)) {
          seen.add(result.chunkKey)
          ddlParts.push(result.ddlText)
        }
      }

      const ddl = ddlParts.join('\n\n')

      logFrontend(
        'debug',
        `[ai-store] DDL assembly complete — uniqueChunks=${ddlParts.length} totalCharsInDdl=${ddl.length}`
      )

      // Update tab state (only if tab still exists — it may have been cleaned up)
      if (get().tabs[tabId]) {
        patchTab(tabId, {
          retrievedSchemaDdl: ddl,
          lastRetrievalTimestamp: Date.now(),
        })
      }

      logFrontend(
        'debug',
        `[ai-store] retrieveSchemaContext complete — ddl ${ddl.length > 0 ? `injected (${ddl.length} chars)` : 'empty (no schema context)'}`
      )

      return ddl
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[ai-store] Schema retrieval failed:', msg)
      logFrontend('error', `[ai-store] Schema retrieval failed: ${msg}`)
      showErrorToast('Schema retrieval failed', msg)
      if (get().tabs[tabId]) {
        patchTab(tabId, { isWaitingForIndex: false })
      }
      return ''
    }
  }

  return {
    tabs: {},

    // ------ sendMessage ------

    sendMessage: (tabId, connectionId, message, settings) => {
      ensureTab(tabId)

      const tab = get().tabs[tabId]!
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
          // Retrieve schema context via the vector pipeline
          const schemaDdl = await retrieveSchemaContext(tabId, connectionId, message)
          if (!get().tabs[tabId]) return // tab was cleaned up while waiting

          // Guard: schema retrieval is async; abort if stream was cancelled before we got here
          if (get().tabs[tabId]?.activeStreamId !== streamId || !get().tabs[tabId]?.isGenerating) {
            return
          }

          // Build and upsert system message with retrieved schema
          if (schemaDdl) {
            upsertSystemMessage(
              tabId,
              `${AI_SYSTEM_PROMPT}\n\n${SCHEMA_USAGE_INSTRUCTION}\n\n${SCHEMA_METADATA_NOTE}\n\nDatabase schema:\n${schemaDdl}`
            )
          } else {
            // No schema available — inject a system prompt without schema DDL
            upsertSystemMessage(tabId, AI_SYSTEM_PROMPT)
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
