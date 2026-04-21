import { test, expect } from '@playwright/test'
import { APP_READY_MS, waitForApp } from './helpers'

async function connectToSample(page: import('@playwright/test').Page) {
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
  await dialog.getByRole('button', { name: /Sample MySQL/ }).click()
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('object-browser')).toBeVisible()
  await expect(page.getByTestId('object-browser').getByText('ecommerce_db')).toBeVisible()
}

test.describe('Process List tab', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page)
    await connectToSample(page)
  })

  test('appears in workspace tab strip after connecting', async ({ page }) => {
    // The workspace tabs strip should contain a "Process List" tab
    const tabStrip = page.getByTestId('workspace-tabs')
    await expect(tabStrip).toBeVisible({ timeout: APP_READY_MS })
    await expect(tabStrip.getByText('Process List')).toBeVisible({ timeout: APP_READY_MS })
  })

  test('has no close button (non-closable)', async ({ page }) => {
    const tabStrip = page.getByTestId('workspace-tabs')
    await expect(tabStrip).toBeVisible({ timeout: APP_READY_MS })
    // Find the Process List tab entry and verify no close button with label matching /^Close / exists
    const processListTab = tabStrip.getByText('Process List').locator('..')
    const closeBtn = processListTab.locator('button[aria-label^="Close "]')
    await expect(closeBtn).toHaveCount(0)
  })

  test('grid renders with data rows', async ({ page }) => {
    const tabStrip = page.getByTestId('workspace-tabs')
    await expect(tabStrip).toBeVisible({ timeout: APP_READY_MS })
    await tabStrip.getByText('Process List').click()
    await expect(page.getByTestId('processlist-grid')).toBeVisible({ timeout: APP_READY_MS })
    // Should have at least one data row from mock
    await expect(page.getByTestId('processlist-grid').locator('.rdg-row').first()).toBeVisible({
      timeout: APP_READY_MS,
    })
  })

  test('refresh button is visible and clickable', async ({ page }) => {
    const tabStrip = page.getByTestId('workspace-tabs')
    await expect(tabStrip).toBeVisible({ timeout: APP_READY_MS })
    await tabStrip.getByText('Process List').click()
    await expect(page.getByTestId('processlist-grid')).toBeVisible({ timeout: APP_READY_MS })
    const refreshBtn = page.getByTestId('processlist-refresh-button')
    await expect(refreshBtn).toBeVisible()
    await refreshBtn.click()
    // After clicking refresh, grid should still be visible with data
    await expect(page.getByTestId('processlist-grid').locator('.rdg-row').first()).toBeVisible({
      timeout: APP_READY_MS,
    })
  })

  test('interval dropdown is visible', async ({ page }) => {
    const tabStrip = page.getByTestId('workspace-tabs')
    await expect(tabStrip).toBeVisible({ timeout: APP_READY_MS })
    await tabStrip.getByText('Process List').click()
    await expect(page.getByTestId('processlist-grid')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByTestId('processlist-interval-dropdown')).toBeVisible()
  })
})
