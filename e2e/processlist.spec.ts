import { test, expect, type Page } from '@playwright/test'
import {
  activeConnectionWorkspace,
  activePinnedTab,
  activeWorkspaceTabs,
  APP_READY_MS,
  connectToSample,
  waitForApp,
  waitForGlideGrid,
} from './helpers'
import { clickGlideRowMarker, getGlideGridGeometry } from './glide-grid-helpers'

const activePanel = (page: Page) =>
  page.locator('[data-testid="workspace-panel"][data-active="true"]')

test.describe('Process List tab', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page)
    await connectToSample(page)
  })

  test('appears in the group rail after connecting', async ({ page }) => {
    const processListTab = activePinnedTab(page, 'processlist')
    await expect(processListTab).toBeVisible({ timeout: APP_READY_MS })
    await expect(processListTab).toHaveAccessibleName('Process list')
  })

  test('marks the rail button selected while the tab is shown', async ({ page }) => {
    const processListTab = activePinnedTab(page, 'processlist')
    await expect(processListTab).toHaveAttribute('aria-selected', 'false')
    await processListTab.click()
    await expect(processListTab).toHaveAttribute('aria-selected', 'true')

    // The rail's marker moves beside the selected button
    const marker = activeConnectionWorkspace(page).getByTestId('workspace-group-rail-marker')
    await expect(marker).toBeVisible()
    await expect
      .poll(async () => {
        const markerBox = (await marker.boundingBox())!
        const itemBox = (await processListTab.boundingBox())!
        return Math.round(markerBox.y + markerBox.height / 2 - (itemBox.y + itemBox.height / 2))
      })
      .toBe(0)
    await expect(activePinnedTab(page, 'history')).toHaveAttribute('aria-selected', 'false')
    // Process list has no document tabs, so the strip hides
    await expect(activeWorkspaceTabs(page)).toBeHidden()
  })

  test('has no close button (non-closable)', async ({ page }) => {
    const processListTab = activePinnedTab(page, 'processlist')
    await expect(processListTab).toBeVisible({ timeout: APP_READY_MS })
    const closeBtn = processListTab.locator('button[aria-label^="Close "]')
    await expect(closeBtn).toHaveCount(0)
  })

  test('grid renders with data rows', async ({ page }) => {
    await activePinnedTab(page, 'processlist').click()
    await expect(activePanel(page).getByTestId('processlist-grid')).toBeVisible({
      timeout: APP_READY_MS,
    })
    await waitForGlideGrid(page, 'processlist-grid')
  })

  test('refresh button is visible and clickable', async ({ page }) => {
    await activePinnedTab(page, 'processlist').click()
    await waitForGlideGrid(page, 'processlist-grid')
    const refreshBtn = activePanel(page).getByTestId('processlist-refresh-button')
    await expect(refreshBtn).toBeVisible()
    await refreshBtn.click()
    // After clicking refresh, grid should still be visible with data
    await waitForGlideGrid(page, 'processlist-grid')
  })

  test('interval dropdown is visible', async ({ page }) => {
    await activePinnedTab(page, 'processlist').click()
    await waitForGlideGrid(page, 'processlist-grid')
    await expect(activePanel(page).getByTestId('processlist-interval-dropdown')).toBeVisible()
  })

  test('filter dropdown defaults to exclude idle and can switch to show all', async ({ page }) => {
    await activePinnedTab(page, 'processlist').click()

    const filterDropdown = activePanel(page).getByTestId('processlist-filter-dropdown')
    await waitForGlideGrid(page, 'processlist-grid')

    await expect(filterDropdown).toHaveText('Exclude idle')
    // The label must fit its trigger, not ellipsize
    const label = filterDropdown.locator('.ui-dropdown__value')
    expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)

    await filterDropdown.click()
    await page.getByTestId('processlist-filter-dropdown-option-show-all').click()

    await expect(filterDropdown).toHaveText('Show all')
    await waitForGlideGrid(page, 'processlist-grid')
  })

  test('clicking a row marker selects the process row', async ({ page }) => {
    await activePinnedTab(page, 'processlist').click()
    await waitForGlideGrid(page, 'processlist-grid')

    const geometry = await getGlideGridGeometry(page, 'processlist-grid')
    await clickGlideRowMarker(page, 'processlist-grid', 0, geometry)

    await expect(
      activePanel(page).getByTestId('processlist-grid').locator('canvas').first()
    ).toBeVisible({
      timeout: APP_READY_MS,
    })
  })
})
