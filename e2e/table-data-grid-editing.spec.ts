import { test, expect, type Page } from '@playwright/test'

const APP_READY_MS = 60_000

async function waitForApp(page: Page) {
  await page.goto('/', { waitUntil: 'load', timeout: APP_READY_MS })
  await expect(page.getByTestId('app-layout')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('status-bar')).toContainText('Ready', { timeout: APP_READY_MS })
}

async function openConnectionManager(page: Page) {
  await page.getByRole('button', { name: 'New Connection' }).first().click()
  await expect(page.getByTestId('connection-dialog')).toBeVisible()
  await expect(page.getByText('Sample MySQL')).toBeVisible()
}

async function connectToSample(page: Page) {
  await openConnectionManager(page)
  await page.getByText('Sample MySQL').click()
  await page
    .getByTestId('connection-dialog')
    .getByRole('button', { name: 'Connect', exact: true })
    .click()
  await expect(page.getByTestId('connection-dialog')).toBeHidden()
  await expect(page.getByTestId('object-browser')).toBeVisible()
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

test('editing a cell then clicking the next cell keeps editing on the clicked cell', async ({
  page,
}) => {
  test.setTimeout(APP_READY_MS)

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

  for (let index = 0; index < 5; index += 1) {
    await nameCell.click()

    const nameEditor = page.locator('.ag-cell-inline-editing[col-id="name"] .td-cell-editor-input')
    await expect(nameEditor).toBeVisible({ timeout: APP_READY_MS })
    await nameEditor.fill(`Julian Thorne ${index}`)

    await emailCell.click()

    const emailEditor = page.locator(
      '.ag-cell-inline-editing[col-id="email"] .td-cell-editor-input'
    )

    await expect(emailEditor).toBeVisible({ timeout: APP_READY_MS })
    await expect(emailEditor).toBeEnabled()
    await expect(page.locator('.ag-cell-inline-editing[col-id="status"]')).toHaveCount(0)

    await emailEditor.fill(`julian-${index}@example.com`)
  }
})
