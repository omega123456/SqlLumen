import { test, expect, type Page } from '@playwright/test'
import { APP_READY_MS, waitForApp } from './helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function dismissAllToasts(page: Page) {
  for (let i = 0; i < 8; i++) {
    const btn = page.getByTestId('toast-dismiss').first()
    if (!(await btn.isVisible().catch(() => false))) break
    await btn.click()
  }
}

async function openConnectionManager(page: Page) {
  const btn = page.getByRole('button', { name: 'New Connection' }).first()
  const dialog = page.getByTestId('connection-dialog')
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await dialog.isVisible())) await btn.click()
    try {
      await expect(dialog).toBeVisible({ timeout: 3_000 })
      break
    } catch (error) {
      if (attempt === 1) throw error
    }
  }
  await expect(dialog.getByText('Sample MySQL')).toBeVisible({ timeout: APP_READY_MS })
}

async function connectToSample(page: Page) {
  await openConnectionManager(page)
  await page
    .getByTestId('connection-dialog')
    .getByRole('button', { name: /Sample MySQL/ })
    .click()
  await page
    .getByTestId('connection-dialog')
    .getByRole('button', { name: 'Connect', exact: true })
    .click()
  await expect(page.getByTestId('connection-dialog')).toBeHidden()
  await expect(page.getByTestId('object-browser')).toBeVisible()
  await expect(page.getByTestId('object-browser').getByText('ecommerce_db')).toBeVisible()
  await dismissAllToasts(page)
}

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
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('editor-toolbar')).toBeVisible()
}

/** Open the AI panel via the workspace rail button. Requires AI to be enabled. */
async function openAiPanel(page: Page) {
  await enableAiViaStore(page)
  await expect(page.getByTestId('ai-sidebar-expand')).toBeVisible({ timeout: APP_READY_MS })
  await page.getByTestId('ai-sidebar-expand').click()
  await expect(page.getByTestId('ai-panel')).toBeVisible({ timeout: APP_READY_MS })
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
    await expect(page.getByTestId('ai-panel')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByTestId('ai-panel-header')).toBeVisible()
    await expect(page.getByTestId('ai-chat-messages')).toBeVisible()
    await expect(page.getByTestId('ai-chat-input')).toBeVisible()
  })

  test('Welcome state — shows welcome message and suggestion chips', async ({ page }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Welcome state should be visible with no messages
    await expect(page.getByTestId('ai-welcome-state')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByText('Ask AI about your SQL')).toBeVisible()
    await expect(page.getByText('Get help writing, explaining,')).toBeVisible()

    // All 4 suggestion chips should be present
    const chips = page.getByTestId('ai-suggestion-chip')
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
    const textarea = page.getByTestId('ai-chat-textarea')
    await textarea.fill('How do I select active users?')
    await page.getByTestId('ai-send-button').click()

    // User message should appear
    await expect(page.getByTestId('ai-message-user')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByTestId('ai-message-user')).toContainText('How do I select active users?')

    // Wait for the AI response to finish streaming
    await expect(page.getByTestId('ai-message-assistant')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByTestId('ai-message-assistant')).toContainText(
      'This query filters for active users',
      { timeout: APP_READY_MS }
    )

    // Welcome state should be gone now
    await expect(page.getByTestId('ai-welcome-state')).toBeHidden()
  })

  test('Suggestion chips — clicking fills textarea', async ({ page }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Click the first suggestion chip
    const firstChip = page.getByTestId('ai-suggestion-chip').first()
    await firstChip.click()

    // The textarea should be filled with the suggestion text
    const textarea = page.getByTestId('ai-chat-textarea')
    await expect(textarea).toHaveValue('Explain this query step by step', {
      timeout: APP_READY_MS,
    })
  })

  test('Panel close — clicking X closes the AI panel', async ({ page }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Panel should be visible
    await expect(page.getByTestId('ai-panel')).toBeVisible()

    // Click the close button
    await page.getByTestId('ai-close-button').click()

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
    const textarea = page.getByTestId('ai-chat-textarea')
    await textarea.fill('Hello AI')
    await page.getByTestId('ai-send-button').click()

    // Wait for response
    await expect(page.getByTestId('ai-message-assistant')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByTestId('ai-message-assistant')).toContainText(
      'This query filters for active users',
      { timeout: APP_READY_MS }
    )

    // Click clear conversation
    await page.getByTestId('ai-clear-button').click()

    // Welcome state should return
    await expect(page.getByTestId('ai-welcome-state')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByTestId('ai-message-user')).toBeHidden()
    await expect(page.getByTestId('ai-message-assistant')).toBeHidden()
  })

  test('Error state — shows error banner when AI endpoint is unreachable', async ({ page }) => {
    await openQueryEditorTab(page)
    await openAiPanel(page)

    // Enable the AI error simulation flag
    await page.evaluate(() => {
      ;(window as unknown as Record<string, unknown>).__mockAiError__ = true
    })

    // Send a message — should trigger error path
    const textarea = page.getByTestId('ai-chat-textarea')
    await textarea.fill('Test error handling')
    await page.getByTestId('ai-send-button').click()

    // Wait for the error banner to appear
    await expect(page.getByTestId('ai-error-banner')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByTestId('ai-error-banner')).toContainText('Connection refused')

    // Clean up
    await page.evaluate(() => {
      delete (window as unknown as Record<string, unknown>).__mockAiError__
    })
  })
})
