import { test, expect, type Page } from '@playwright/test'
import { APP_READY_MS, waitForApp } from './helpers'

async function dismissAllToasts(page: Page) {
  for (let i = 0; i < 8; i++) {
    const btn = page.getByTestId('toast-dismiss').first()
    if (!(await btn.isVisible().catch(() => false))) {
      break
    }
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
  await expect(page.getByText('ecommerce_db')).toBeVisible()
  await dismissAllToasts(page)
}

async function openQueryEditorTab(page: Page) {
  await connectToSample(page)
  await page.getByTestId('new-query-tab-button').click()
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('editor-toolbar')).toBeVisible()
}

/** Set SQL content in the active query tab and wait for React to re-render. */
async function setQueryContent(page: Page, sql: string) {
  await page.evaluate((content) => {
    const wsStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => {
        tabsByConnection: Record<string, { id: string; type: string }[]>
      }
    }
    const activeTabs = wsStore.getState().tabsByConnection['session-playwright-1'] ?? []
    const queryTab = activeTabs.find((t) => t.type === 'query-editor')
    if (queryTab) {
      const qStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
        getState: () => { setContent: (id: string, c: string) => void }
      }
      qStore.getState().setContent(queryTab.id, content)
    }
  }, sql)
  await page.waitForTimeout(300)
}

/** Set the mock query delay via window.__mockQueryDelay__. */
async function setMockQueryDelay(page: Page, delayMs: number) {
  await page.evaluate((ms) => {
    ;(window as unknown as Record<string, unknown>).__mockQueryDelay__ = ms
  }, delayMs)
}

/** Clear the mock query delay. */
async function clearMockQueryDelay(page: Page) {
  if (page.isClosed()) return
  try {
    await page.evaluate(() => {
      delete (window as unknown as Record<string, unknown>).__mockQueryDelay__
      delete (window as unknown as Record<string, unknown>).__pendingQueryReject__
    })
  } catch {
    // Context may have been destroyed — non-fatal cleanup.
  }
}

test.describe('Query running indicator', () => {
  test('running indicator appears during delayed query and disappears after completion', async ({
    page,
  }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)
    await setQueryContent(page, 'SELECT * FROM users;')

    // Set a 2-second delay on query execution
    await setMockQueryDelay(page, 2_000)

    try {
      // Click Execute Query
      await page.getByTestId('toolbar-execute').click()

      // Assert running indicator components are visible
      await expect(page.getByTestId('running-indicator')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('running-timer')).toBeVisible()
      await expect(page.getByTestId('cancel-query-button')).toBeVisible()

      // Assert execute buttons are NOT visible while running
      await expect(page.getByTestId('toolbar-execute')).not.toBeVisible()
      await expect(page.getByTestId('toolbar-execute-all')).not.toBeVisible()

      // Wait for the query to complete (the 2s delay will resolve)
      await expect(page.getByTestId('running-indicator')).not.toBeVisible({ timeout: 5_000 })

      // Execute buttons should reappear after completion
      await expect(page.getByTestId('toolbar-execute')).toBeVisible({ timeout: APP_READY_MS })
    } finally {
      await clearMockQueryDelay(page)
    }
  })

  test('cancel button terminates running query', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)
    await setQueryContent(page, 'SELECT * FROM users;')

    // Set a long delay so the query won't complete naturally
    await setMockQueryDelay(page, 10_000)

    try {
      // Click Execute Query
      await page.getByTestId('toolbar-execute').click()

      // Wait for running indicator to appear
      await expect(page.getByTestId('running-indicator')).toBeVisible({ timeout: APP_READY_MS })

      // Click Cancel
      await page.getByTestId('cancel-query-button').click()

      // Running indicator should disappear after cancellation
      await expect(page.getByTestId('running-indicator')).not.toBeVisible({ timeout: 5_000 })

      // Execute buttons should reappear
      await expect(page.getByTestId('toolbar-execute')).toBeVisible({ timeout: APP_READY_MS })
    } finally {
      await clearMockQueryDelay(page)
    }
  })

  test('overlay blocks interactions while running', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)
    await setQueryContent(page, 'SELECT * FROM users;')

    // Set a delay so the query stays running long enough to check
    await setMockQueryDelay(page, 3_000)

    try {
      // Click Execute Query
      await page.getByTestId('toolbar-execute').click()

      // Wait for running state
      await expect(page.getByTestId('running-indicator')).toBeVisible({ timeout: APP_READY_MS })

      // Assert overlay is present
      await expect(page.getByTestId('query-execution-overlay')).toBeAttached()

      // Wait for query to complete
      await expect(page.getByTestId('running-indicator')).not.toBeVisible({ timeout: 5_000 })

      // Overlay should be gone
      await expect(page.getByTestId('query-execution-overlay')).not.toBeAttached()
    } finally {
      await clearMockQueryDelay(page)
    }
  })
})
