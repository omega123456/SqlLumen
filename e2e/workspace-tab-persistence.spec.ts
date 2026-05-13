import { expect, test, type Locator, type Page } from '@playwright/test'
import { APP_READY_MS, connectToSample, waitForApp } from './helpers'

function activePanel(page: Page): Locator {
  return page.locator('[data-testid="workspace-panel"][data-active="true"]')
}

async function openWorkspaceTab(page: Page, tab: Record<string, unknown>): Promise<string> {
  return page.evaluate((workspaceTab) => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => {
        activeTabByConnection: Record<string, string | null>
        openTab: (tab: Record<string, unknown>) => void
      }
    }
    store.getState().openTab(workspaceTab)
    const activeTabId = store.getState().activeTabByConnection['session-playwright-1']
    if (!activeTabId) throw new Error('No active workspace tab after opening tab')
    return activeTabId
  }, tab)
}

async function openScrollTableDataTab(page: Page): Promise<string> {
  const tabId = await openWorkspaceTab(page, {
    type: 'table-data',
    label: 'scroll_test',
    connectionId: 'session-playwright-1',
    databaseName: 'ecommerce_db',
    objectName: 'scroll_test',
    objectType: 'table',
  })

  await expect(page.locator(`[data-testid="workspace-panel"][data-tab-id="${tabId}"]`)).toHaveAttribute(
    'data-active',
    'true',
    { timeout: APP_READY_MS }
  )
  await expect(activePanel(page).getByTestId('table-data-grid')).toBeVisible({ timeout: APP_READY_MS })
  await expect(activePanel(page).getByTestId('table-data-grid').locator('canvas').first()).toBeVisible({
    timeout: APP_READY_MS,
  })
  return tabId
}

async function openQueryEditorTab(page: Page): Promise<string> {
  await page.getByTestId('new-query-tab-button').click()

  const tabId = await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { activeTabByConnection: Record<string, string | null> }
    }
    const activeTabId = store.getState().activeTabByConnection['session-playwright-1']
    if (!activeTabId) throw new Error('No active query tab')
    return activeTabId
  })

  await expect(page.locator(`[data-testid="workspace-panel"][data-tab-id="${tabId}"]`)).toHaveAttribute(
    'data-active',
    'true',
    { timeout: APP_READY_MS }
  )
  await expect(activePanel(page).getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

  return tabId
}

async function openQueryEditorWithScrollableResults(page: Page): Promise<string> {
  const tabId = await openQueryEditorTab(page)

  await expect(page.locator(`[data-testid="workspace-panel"][data-tab-id="${tabId}"]`)).toHaveAttribute(
    'data-active',
    'true',
    { timeout: APP_READY_MS }
  )

  await page.evaluate((queryTabId) => {
    const queryStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
      getState: () => { setContent: (id: string, content: string) => void }
    }
    queryStore.getState().setContent(queryTabId, 'SELECT * FROM scroll_test;')
  }, tabId)

  await page.keyboard.press('F9')
  await expect(activePanel(page).getByTestId('result-grid')).toBeVisible({ timeout: APP_READY_MS })
  await expect(activePanel(page).getByTestId('result-grid').locator('canvas').first()).toBeVisible({
    timeout: APP_READY_MS,
  })
  return tabId
}

async function activateWorkspaceTab(page: Page, tabId: string): Promise<void> {
  await page.locator(`[data-testid="workspace-tab-${tabId}"]`).click()
  await expect(page.locator(`[data-testid="workspace-panel"][data-tab-id="${tabId}"]`)).toHaveAttribute(
    'data-active',
    'true',
    { timeout: APP_READY_MS }
  )
}

async function scrollGrid(grid: Locator, deltaY: number): Promise<number> {
  await grid.evaluate((element, scrollBy) => {
    const scroller = element.querySelector<HTMLElement>('.dvn-scroller') ?? (element as HTMLElement)
    scroller.scrollTop = scrollBy
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
  }, deltaY)

  return grid.evaluate((element) => {
    const scroller = element.querySelector<HTMLElement>('.dvn-scroller') ?? (element as HTMLElement)
    return scroller.scrollTop
  })
}

async function getGridScrollTop(grid: Locator): Promise<number> {
  return grid.evaluate((element) => {
    const scroller = element.querySelector<HTMLElement>('.dvn-scroller') ?? (element as HTMLElement)
    return scroller.scrollTop
  })
}

test.describe('Workspace tab persistence', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page)
    await connectToSample(page)
  })

  test('retains table-data grid scroll after switching tabs', async ({ page }) => {
    const tableTabId = await openScrollTableDataTab(page)
    const tableGrid = activePanel(page).getByTestId('table-data-grid')
    const scrolledTop = await scrollGrid(tableGrid, 900)
    expect(scrolledTop).toBeGreaterThan(0)

    const queryTabId = await openQueryEditorTab(page)
    await activateWorkspaceTab(page, queryTabId)
    await activateWorkspaceTab(page, tableTabId)

    await expect.poll(() => getGridScrollTop(activePanel(page).getByTestId('table-data-grid'))).toBeGreaterThan(0)
  })

  test('retains query result grid scroll after switching tabs', async ({ page }) => {
    const queryTabId = await openQueryEditorWithScrollableResults(page)
    const resultGrid = activePanel(page).getByTestId('result-grid')
    const scrolledTop = await scrollGrid(resultGrid, 900)
    expect(scrolledTop).toBeGreaterThan(0)

    const tableTabId = await openScrollTableDataTab(page)
    await activateWorkspaceTab(page, tableTabId)
    await activateWorkspaceTab(page, queryTabId)

    await expect.poll(() => getGridScrollTop(activePanel(page).getByTestId('result-grid'))).toBeGreaterThan(0)
  })

  test('keeps multiple workspace panels mounted with one active panel', async ({ page }) => {
    await openScrollTableDataTab(page)
    await openQueryEditorTab(page)

    const panels = page.getByTestId('workspace-panel')
    await expect(panels).toHaveCount(4, { timeout: APP_READY_MS })
    await expect(page.locator('[data-testid="workspace-panel"][data-active="true"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="workspace-panel"][data-active="false"]')).toHaveCount(3)
  })

  test('ignores FK lookup keyboard actions dispatched from an inactive grid', async ({ page }) => {
    const tableTabId = await openWorkspaceTab(page, {
      type: 'table-data',
      label: 'orders',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'orders',
      objectType: 'table',
    })
    await expect(page.locator(`[data-testid="workspace-panel"][data-tab-id="${tableTabId}"]`)).toHaveAttribute(
      'data-active',
      'true',
      { timeout: APP_READY_MS }
    )
    await expect(activePanel(page).getByTestId('table-data-grid')).toBeVisible({ timeout: APP_READY_MS })

    await openQueryEditorTab(page)
    const inactivePanel = page.locator(`[data-testid="workspace-panel"][data-tab-id="${tableTabId}"]`)
    await expect(inactivePanel).toHaveAttribute('data-active', 'false')

    await inactivePanel.getByTestId('table-data-grid').dispatchEvent('keydown', { key: 'F4', code: 'F4' })
    await expect(page.getByTestId('fk-lookup-dialog')).toBeHidden()
    await expect(activePanel(page).getByTestId('query-editor-tab')).toBeVisible()
  })

  test('does not leak an open dropdown overlay after switching away', async ({ page }) => {
    await page.getByTestId('workspace-tabs').getByText('Process List').click()
    const processListTabId = await page.evaluate(() => {
      const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
        getState: () => { activeTabByConnection: Record<string, string | null> }
      }
      const activeTabId = store.getState().activeTabByConnection['session-playwright-1']
      if (!activeTabId) throw new Error('No active process list tab')
      return activeTabId
    })
    await expect(
      page.locator(`[data-testid="workspace-panel"][data-tab-id="${processListTabId}"]`)
    ).toHaveAttribute('data-active', 'true', { timeout: APP_READY_MS })
    await expect(activePanel(page).getByTestId('processlist-filter-dropdown')).toBeVisible({
      timeout: APP_READY_MS,
    })
    await activePanel(page).getByTestId('processlist-filter-dropdown').click()
    await expect(page.getByTestId('processlist-filter-dropdown-option-show-all')).toBeVisible()

    await openQueryEditorTab(page)

    await expect(page.getByTestId('processlist-filter-dropdown-option-show-all')).toBeHidden()
    await expect(page.getByRole('listbox')).toBeHidden()
  })
})
