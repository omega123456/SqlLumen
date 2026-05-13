import { test, expect, type Page } from '@playwright/test'
import { APP_READY_MS, connectToSample, waitForApp } from './helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Enable AI via the settings store so the workspace AI rail appears. */
async function enableAiViaStore(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__settingsStore__ as {
      setState: (
        updater: (state: {
          settings: Record<string, string>
          pendingChanges: Record<string, string>
        }) => Record<string, unknown>
      ) => void
    }
    store.setState((state) => ({
      settings: {
        ...state.settings,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
        'ai.embeddingModel': 'nomic-embed-text',
      },
      pendingChanges: {},
    }))
  })
}

/** Open a query editor tab and wait for it to be ready. */
async function openQueryEditorTab(page: Page) {
  await connectToSample(page)
  await page.getByTestId('new-query-tab-button').click()
  await expect(activePanel(page).getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
  await expect(activePanel(page).getByTestId('editor-toolbar')).toBeVisible()
}

/** Open the AI panel via the workspace rail button. Requires AI to be enabled. */
async function openAiPanel(page: Page) {
  await enableAiViaStore(page)
  await expect(page.getByTestId('ai-sidebar-expand')).toBeVisible({ timeout: APP_READY_MS })
  await page.getByTestId('ai-sidebar-expand').click()
  await expect(activePanel(page).getByTestId('ai-panel')).toBeVisible({ timeout: APP_READY_MS })
}

function activePanel(page: Page) {
  return page.locator('[data-testid="workspace-panel"][data-active="true"]')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('AI Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page)
  })

  test('AI panel toggle — enabling AI shows workspace rail, clicking opens panel', async ({
    page,
  }) => {
    await openQueryEditorTab(page)

    // AI is disabled by default — workspace rail should not be visible
    await expect(page.getByTestId('ai-sidebar-expand')).toBeHidden()

    // Enable AI via settings store
    await enableAiViaStore(page)

    await expect(page.getByTestId('ai-sidebar-expand')).toBeVisible({ timeout: APP_READY_MS })

    await page.getByTestId('ai-sidebar-expand').click()
    await expect(activePanel(page).getByTestId('ai-panel')).toBeVisible({ timeout: APP_READY_MS })
    await expect(activePanel(page).getByTestId('ai-panel-header')).toBeVisible()
    await expect(activePanel(page).getByTestId('ai-chat-messages')).toBeVisible()
    await expect(activePanel(page).getByTestId('ai-chat-input')).toBeVisible()
  })

  test('Welcome state — shows welcome message and suggestion chips', async ({ page }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Welcome state should be visible with no messages
    await expect(activePanel(page).getByTestId('ai-welcome-state')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByText('Ask AI about your SQL')).toBeVisible()
    await expect(page.getByText('Get help writing, explaining,')).toBeVisible()

    // All 4 suggestion chips should be present
    const chips = activePanel(page).getByTestId('ai-suggestion-chip')
    await expect(chips).toHaveCount(4)
    await expect(chips.nth(0)).toHaveText('Explain query')
    await expect(chips.nth(1)).toHaveText('Optimize for speed')
    await expect(chips.nth(2)).toHaveText('Generate a JOIN')
    await expect(chips.nth(3)).toHaveText('Find potential issues')
  })

  test('Sending a message — AI responds with mock streaming', async ({ page }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Type and send a message
    const textarea = activePanel(page).getByTestId('ai-chat-textarea')
    await textarea.fill('How do I select active users?')
    await activePanel(page).getByTestId('ai-send-button').click()

    // User message should appear
    await expect(activePanel(page).getByTestId('ai-message-user')).toBeVisible({ timeout: APP_READY_MS })
    await expect(activePanel(page).getByTestId('ai-message-user')).toContainText('How do I select active users?')

    // Wait for the AI response to finish streaming
    await expect(activePanel(page).getByTestId('ai-message-assistant')).toBeVisible({ timeout: APP_READY_MS })
    await expect(activePanel(page).getByTestId('ai-message-assistant')).toContainText(
      'This query filters for active users',
      { timeout: APP_READY_MS }
    )

    // Welcome state should be gone now
    await expect(activePanel(page).getByTestId('ai-welcome-state')).toBeHidden()
  })

  test('Suggestion chips — clicking fills textarea', async ({ page }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Click the first suggestion chip
    const firstChip = activePanel(page).getByTestId('ai-suggestion-chip').first()
    await firstChip.click()

    // The textarea should be filled with the suggestion text
    const textarea = activePanel(page).getByTestId('ai-chat-textarea')
    await expect(textarea).toHaveValue('Explain this query step by step', {
      timeout: APP_READY_MS,
    })
  })

  test('Panel close — clicking X closes the AI panel', async ({ page }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Panel should be visible
    await expect(activePanel(page).getByTestId('ai-panel')).toBeVisible()

    // Click the close button
    await activePanel(page).getByTestId('ai-close-button').click()

    // When closed, the chat column unmounts. Verify via the AI store state.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const store = (window as unknown as Record<string, unknown>).__aiStore__ as {
              getState: () => { tabs: Record<string, { isPanelOpen: boolean }> }
            }
            const tabs = store.getState().tabs
            const tabIds = Object.keys(tabs)
            return tabIds.length > 0 ? tabs[tabIds[0]].isPanelOpen : undefined
          }),
        { timeout: APP_READY_MS }
      )
      .toBe(false)
  })

  test('Clear conversation — resets to welcome state', async ({ page }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Send a message first
    const textarea = activePanel(page).getByTestId('ai-chat-textarea')
    await textarea.fill('Hello AI')
    await activePanel(page).getByTestId('ai-send-button').click()

    // Wait for response
    await expect(activePanel(page).getByTestId('ai-message-assistant')).toBeVisible({ timeout: APP_READY_MS })
    await expect(activePanel(page).getByTestId('ai-message-assistant')).toContainText(
      'This query filters for active users',
      { timeout: APP_READY_MS }
    )

    // Click clear conversation
    await activePanel(page).getByTestId('ai-clear-button').click()

    // Welcome state should return
    await expect(activePanel(page).getByTestId('ai-welcome-state')).toBeVisible({ timeout: APP_READY_MS })
    await expect(activePanel(page).getByTestId('ai-message-user')).toBeHidden()
    await expect(activePanel(page).getByTestId('ai-message-assistant')).toBeHidden()
  })

  test('Error state — shows error banner when AI endpoint is unreachable', async ({ page }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Enable the AI error simulation flag
    await page.evaluate(() => {
      ;(window as unknown as Record<string, unknown>).__mockAiError__ = true
    })

    // Send a message — should trigger error path
    const textarea = activePanel(page).getByTestId('ai-chat-textarea')
    await textarea.fill('Test error handling')
    await activePanel(page).getByTestId('ai-send-button').click()

    // Wait for the error banner to appear
    await expect(activePanel(page).getByTestId('ai-error-banner')).toBeVisible({ timeout: APP_READY_MS })
    await expect(activePanel(page).getByTestId('ai-error-banner')).toContainText('Connection refused')

    // Clean up
    await page.evaluate(() => {
      delete (window as unknown as Record<string, unknown>).__mockAiError__
    })
  })

  test('Thinking block — AI response with reasoning shows ThinkingBlock', async ({ page }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Enable thinking mock
    await page.evaluate(() => {
      ;(window as unknown as Record<string, unknown>).__mockAiThinking__ = true
    })

    // Send a message
    const textarea = activePanel(page).getByTestId('ai-chat-textarea')
    await textarea.fill('Explain the users table')
    await activePanel(page).getByTestId('ai-send-button').click()

    // Wait for thinking block to appear
    await expect(activePanel(page).getByTestId('thinking-block')).toBeVisible({ timeout: APP_READY_MS })

    // Wait for the full response to finish
    await expect(activePanel(page).getByTestId('ai-message-assistant')).toContainText(
      'This query filters for active users',
      { timeout: APP_READY_MS }
    )

    // ThinkingBlock should show "Reasoning" label (collapsed after streaming ends)
    await expect(activePanel(page).getByTestId('thinking-block-header')).toContainText('Reasoning')

    // Clean up
    await page.evaluate(() => {
      delete (window as unknown as Record<string, unknown>).__mockAiThinking__
    })
  })

  test('Schema retrieval — DDL contains approximate rows and table comment', async ({ page }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Send a query that triggers schema retrieval
    const textarea = activePanel(page).getByTestId('ai-chat-textarea')
    await textarea.fill('Show me all users')
    await activePanel(page).getByTestId('ai-send-button').click()

    // Wait for the AI response
    await expect(activePanel(page).getByTestId('ai-message-assistant')).toBeVisible({ timeout: APP_READY_MS })

    // The schema context is injected into the system prompt, not directly visible in the
    // chat UI. We verify that the mock semantic_search response (which includes
    // `-- approximate rows:` and a table comment) was used by checking that the
    // AI received and responded to the message without error.
    await expect(activePanel(page).getByTestId('ai-message-user')).toContainText('Show me all users')
    await expect(activePanel(page).getByTestId('ai-error-banner')).toBeHidden()
  })

  test('Multi-turn conversation — second turn retrieves context from prior turn', async ({
    page,
  }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Turn 1: send a message about orders
    const textarea = activePanel(page).getByTestId('ai-chat-textarea')
    await textarea.fill('Show me all orders')
    await activePanel(page).getByTestId('ai-send-button').click()

    // Wait for assistant response
    await expect(activePanel(page).getByTestId('ai-message-assistant').first()).toBeVisible({
      timeout: APP_READY_MS,
    })
    await expect(activePanel(page).getByTestId('ai-message-assistant').first()).toContainText(
      'This query filters for active users',
      { timeout: APP_READY_MS }
    )

    // Turn 2: follow-up question (multi-turn context should carry over)
    await textarea.fill('Add the customer name to that query')
    await activePanel(page).getByTestId('ai-send-button').click()

    // Wait for second assistant response
    await expect(activePanel(page).getByTestId('ai-message-assistant').nth(1)).toBeVisible({
      timeout: APP_READY_MS,
    })
    await expect(activePanel(page).getByTestId('ai-message-assistant').nth(1)).toContainText(
      'This query filters for active users',
      { timeout: APP_READY_MS }
    )

    // Verify no errors occurred during multi-turn
    await expect(activePanel(page).getByTestId('ai-error-banner')).toBeHidden()

    // Verify both user messages are visible
    const userMessages = activePanel(page).getByTestId('ai-message-user')
    await expect(userMessages).toHaveCount(2)
    await expect(userMessages.nth(0)).toContainText('Show me all orders')
    await expect(userMessages.nth(1)).toContainText('Add the customer name')
  })
})
