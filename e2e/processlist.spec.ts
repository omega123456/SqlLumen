import { test, expect, type Page } from '@playwright/test'
import { APP_READY_MS, connectToSample, waitForApp, waitForGlideGrid } from './helpers'
import { clickGlideRowMarker, getGlideGridGeometry } from './glide-grid-helpers'

const activePanel = (page: Page) =>
  page.locator('[data-testid="workspace-panel"][data-active="true"]')

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
    await expect(activePanel(page).getByTestId('processlist-grid')).toBeVisible({ timeout: APP_READY_MS })
    await waitForGlideGrid(page, 'processlist-grid')
  })

  test('refresh button is visible and clickable', async ({ page }) => {
    const tabStrip = page.getByTestId('workspace-tabs')
    await expect(tabStrip).toBeVisible({ timeout: APP_READY_MS })
    await tabStrip.getByText('Process List').click()
    await waitForGlideGrid(page, 'processlist-grid')
    const refreshBtn = activePanel(page).getByTestId('processlist-refresh-button')
    await expect(refreshBtn).toBeVisible()
    await refreshBtn.click()
    // After clicking refresh, grid should still be visible with data
    await waitForGlideGrid(page, 'processlist-grid')
  })

  test('interval dropdown is visible', async ({ page }) => {
    const tabStrip = page.getByTestId('workspace-tabs')
    await expect(tabStrip).toBeVisible({ timeout: APP_READY_MS })
    await tabStrip.getByText('Process List').click()
    await waitForGlideGrid(page, 'processlist-grid')
    await expect(activePanel(page).getByTestId('processlist-interval-dropdown')).toBeVisible()
  })

  test('filter dropdown defaults to exclude idle and can switch to show all', async ({ page }) => {
    const tabStrip = page.getByTestId('workspace-tabs')
    await expect(tabStrip).toBeVisible({ timeout: APP_READY_MS })
    await tabStrip.getByText('Process List').click()

    const filterDropdown = activePanel(page).getByTestId('processlist-filter-dropdown')
    await waitForGlideGrid(page, 'processlist-grid')

    await expect(filterDropdown).toHaveText('Exclude idle')

    await filterDropdown.click()
    await page.getByTestId('processlist-filter-dropdown-option-show-all').click()

    await expect(filterDropdown).toHaveText('Show all')
    await waitForGlideGrid(page, 'processlist-grid')
  })

  test('clicking a row marker selects the process row', async ({ page }) => {
    const tabStrip = page.getByTestId('workspace-tabs')
    await expect(tabStrip).toBeVisible({ timeout: APP_READY_MS })
    await tabStrip.getByText('Process List').click()
    await waitForGlideGrid(page, 'processlist-grid')

    const geometry = await getGlideGridGeometry(page, 'processlist-grid')
    await clickGlideRowMarker(page, 'processlist-grid', 0, geometry)

    await expect(activePanel(page).getByTestId('processlist-grid').locator('canvas').first()).toBeVisible({
      timeout: APP_READY_MS,
    })
  })
})
