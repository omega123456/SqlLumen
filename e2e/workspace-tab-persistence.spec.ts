import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  activeConnectionWorkspace,
  activeWorkspaceTabs,
  APP_READY_MS,
  connectToSample,
  dismissAllToasts,
  waitForApp,
} from './helpers'

const PRIMARY_SESSION_ID = 'session-playwright-1'

function activePanel(page: Page): Locator {
  return activeConnectionWorkspace(page).locator(
    '[data-testid="workspace-panel"][data-active="true"]'
  )
}

async function openWorkspaceTab(
  page: Page,
  tab: Record<string, unknown>,
  sessionId: string = PRIMARY_SESSION_ID
): Promise<string> {
  return page.evaluate(
    ({ workspaceTab, ownerSessionId }) => {
      const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
        getState: () => {
          activeTabByConnection: Record<string, string | null>
          openTab: (tab: Record<string, unknown>) => void
        }
      }
      store.getState().openTab(workspaceTab)
      const activeTabId = store.getState().activeTabByConnection[ownerSessionId]
      if (!activeTabId) throw new Error('No active workspace tab after opening tab')
      return activeTabId
    },
    { workspaceTab: tab, ownerSessionId: sessionId }
  )
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

const SECOND_SESSION_ID = 'session-playwright-2'

/**
 * Open a second Sample MySQL session through real frontend connection actions.
 *
 * Opens the connection manager and connects the saved sample profile a second
 * time, which the deterministic Playwright mock allocates as
 * `session-playwright-2`. Toasts are dismissed first so the saved-connection
 * row text is not ambiguous with an overlapping connect toast.
 */
async function openSecondSession(page: Page): Promise<void> {
  await dismissAllToasts(page)

  const dialog = page.getByTestId('connection-dialog')
  if (!(await dialog.isVisible())) {
    await page.getByRole('button', { name: 'New Connection' }).first().click()
  }
  await expect(dialog).toBeVisible({ timeout: APP_READY_MS })

  const sampleRow = page.getByTestId('saved-connections-pane').getByRole('button', {
    name: /Sample MySQL/,
  })
  await expect(sampleRow).toBeVisible({ timeout: APP_READY_MS })
  await sampleRow.click()

  const connectBtn = dialog.getByRole('button', { name: 'Connect', exact: true })
  await expect(connectBtn).toBeEnabled({ timeout: APP_READY_MS })
  await connectBtn.click()
  await expect(dialog).toBeHidden({ timeout: APP_READY_MS })

  await expect(page.getByTestId(`connection-session-tab-${SECOND_SESSION_ID}`)).toBeVisible({
    timeout: APP_READY_MS,
  })
  await expect(activeConnectionWorkspace(page)).toHaveAttribute(
    'data-session-id',
    SECOND_SESSION_ID,
    { timeout: APP_READY_MS }
  )
  await dismissAllToasts(page)
}

/** Click a connection session tab and wait for it to become the visible workspace. */
async function switchToSession(page: Page, sessionId: string): Promise<void> {
  await page.getByTestId(`connection-session-tab-${sessionId}`).click()
  await expect(activeConnectionWorkspace(page)).toHaveAttribute('data-session-id', sessionId, {
    timeout: APP_READY_MS,
  })
}

test.describe('Multi-session workspace persistence', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page)
    await connectToSample(page)
  })

  test('retains table-data grid scroll across a connection switch and back', async ({ page }) => {
    const tableTabId = await openScrollTableDataTab(page)
    const tableGrid = activePanel(page).getByTestId('table-data-grid')
    const scrolledTop = await scrollGrid(tableGrid, 900)
    expect(scrolledTop).toBeGreaterThan(0)

    await openSecondSession(page)
    await switchToSession(page, PRIMARY_SESSION_ID)

    await expect(activePanel(page).getByTestId('table-data-grid')).toBeVisible({
      timeout: APP_READY_MS,
    })
    await expect
      .poll(() => getGridScrollTop(activePanel(page).getByTestId('table-data-grid')))
      .toBeGreaterThan(0)
    void tableTabId
  })

  test('retains query-result grid scroll across a connection switch and back', async ({ page }) => {
    await openQueryEditorWithScrollableResults(page)
    const resultGrid = activePanel(page).getByTestId('result-grid')
    const scrolledTop = await scrollGrid(resultGrid, 900)
    expect(scrolledTop).toBeGreaterThan(0)

    await openSecondSession(page)
    await switchToSession(page, PRIMARY_SESSION_ID)

    await expect(activePanel(page).getByTestId('result-grid')).toBeVisible({
      timeout: APP_READY_MS,
    })
    await expect
      .poll(() => getGridScrollTop(activePanel(page).getByTestId('result-grid')))
      .toBeGreaterThan(0)
  })

  test('retains each open session workspace subtree while only one is visible', async ({ page }) => {
    await openScrollTableDataTab(page)
    await openSecondSession(page)

    // Exactly one connection workspace is active; the other is retained but hidden.
    await expect(page.getByTestId('active-connection-workspace')).toHaveCount(1)
    await expect(page.getByTestId('inactive-connection-workspace')).toHaveCount(1)

    // The retained inactive workspace still has its panels mounted but inert.
    const inactiveWorkspace = page.getByTestId('inactive-connection-workspace')
    await expect(inactiveWorkspace).toHaveAttribute('aria-hidden', 'true')
    await expect(inactiveWorkspace.getByTestId('workspace-panel').first()).toBeAttached()
  })

  test('closing a session removes its retained subtree and reveals a fallback root', async ({
    page,
  }) => {
    await openSecondSession(page)
    await expect(page.getByTestId('inactive-connection-workspace')).toHaveCount(1)

    // Close the active (second) session via its connection tab close control.
    const secondTab = page.getByTestId(`connection-session-tab-${SECOND_SESSION_ID}`)
    await secondTab.getByRole('button', { name: /close/i }).click()

    await expect(page.getByTestId(`connection-session-tab-${SECOND_SESSION_ID}`)).toBeHidden({
      timeout: APP_READY_MS,
    })
    await expect(page.getByTestId('inactive-connection-workspace')).toHaveCount(0)
    await expect(page.getByTestId('active-connection-workspace')).toHaveCount(1)
    await expect(activeConnectionWorkspace(page)).toHaveAttribute(
      'data-session-id',
      PRIMARY_SESSION_ID,
      { timeout: APP_READY_MS }
    )
    await expect(activeWorkspaceTabs(page)).toBeVisible({ timeout: APP_READY_MS })
  })
})
