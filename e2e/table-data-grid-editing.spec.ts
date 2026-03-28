import { test, expect, type Page } from '@playwright/test'

const APP_READY_MS = 5_000

async function waitForApp(page: Page) {
  await page.goto('/', { waitUntil: 'load', timeout: APP_READY_MS })
  await expect(page.getByTestId('app-layout')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('status-bar')).toContainText('Ready', { timeout: APP_READY_MS })
}

async function openConnectionManager(page: Page) {
  const btn = page.getByRole('button', { name: 'New Connection' }).first()
  const dialog = page.getByTestId('connection-dialog')

  // The click → Zustand update → React effect → showModal() chain can be delayed
  // under load.  Retry the click once if the dialog doesn't appear promptly.
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
  await page.getByText('Sample MySQL').click()
  await page
    .getByTestId('connection-dialog')
    .getByRole('button', { name: 'Connect', exact: true })
    .click()
  await expect(page.getByTestId('connection-dialog')).toBeHidden()
  await expect(page.getByTestId('object-browser')).toBeVisible({ timeout: APP_READY_MS })
}

async function openTableDataTab(page: Page) {
  await connectToSample(page)

  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { openTab: (tab: Record<string, unknown>) => void }
    }
    store.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'users',
      objectType: 'table',
    })
  })

  await expect(page.getByTestId('table-data-tab')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('table-data-toolbar')).toContainText('Rows', {
    timeout: APP_READY_MS,
  })
}

/**
 * Click a grid cell by dispatching a click event directly on the cell DOM
 * element via evaluate, bypassing Playwright's coordinate-based hit test.
 * This avoids issues with AG Grid's absolute positioning causing stale
 * coordinates after cell editing modifies column widths.
 */
async function clickCellByColId(page: Page, grid: ReturnType<Page['locator']>, colId: string) {
  const cell = grid.locator(`.ag-row[row-index="0"] .ag-cell[col-id="${colId}"]`)
  await expect(cell).toBeVisible({ timeout: APP_READY_MS })
  await cell.dispatchEvent('click')
}

test('editing a cell then clicking the next cell keeps editing on the clicked cell', async ({
  page,
}) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  const nameCell = grid.locator('.ag-row[row-index="0"] .ag-cell[col-id="name"]')
  const emailCell = grid.locator('.ag-row[row-index="0"] .ag-cell[col-id="email"]')
  const statusCell = grid.locator('.ag-row[row-index="0"] .ag-cell[col-id="status"]')

  await expect(nameCell).toBeVisible({ timeout: APP_READY_MS })
  await expect(emailCell).toBeVisible({ timeout: APP_READY_MS })
  await expect(statusCell).toBeVisible({ timeout: APP_READY_MS })

  for (let index = 0; index < 3; index += 1) {
    // Click the name cell via dispatchEvent to avoid coordinate drift
    await clickCellByColId(page, grid, 'name')

    const nameEditor = page.locator('.ag-cell-inline-editing[col-id="name"] .td-cell-editor-input')
    await expect(nameEditor).toBeVisible({ timeout: APP_READY_MS })
    await nameEditor.fill(`Julian Thorne ${index}`)

    // Click the email cell via dispatchEvent to transition editing
    await clickCellByColId(page, grid, 'email')

    const emailEditor = page.locator(
      '.ag-cell-inline-editing[col-id="email"] .td-cell-editor-input'
    )

    await expect(emailEditor).toBeVisible({ timeout: APP_READY_MS })
    await expect(emailEditor).toBeEnabled()
    await expect(page.locator('.ag-cell-inline-editing[col-id="status"]')).toHaveCount(0)

    await emailEditor.fill(`julian-${index}@example.com`)
  }
})
