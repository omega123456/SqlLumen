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

async function openQueryEditorWithResults(page: Page) {
  await connectToSample(page)
  await page.getByTestId('new-query-tab-button').click()
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('editor-toolbar')).toBeVisible({ timeout: APP_READY_MS })

  await page.evaluate(() => {
    const wsStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => {
        tabsByConnection: Record<string, { id: string; type: string }[]>
      }
    }
    const activeTabs = wsStore.getState().tabsByConnection['session-playwright-1'] ?? []
    const queryTab = activeTabs.find((t) => t.type === 'query-editor')
    if (!queryTab) {
      throw new Error('Query tab not found')
    }

    const qStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
      getState: () => { setContent: (id: string, c: string) => void }
    }
    qStore.getState().setContent(queryTab.id, 'SELECT * FROM users;')
  })

  await expect(page.getByTestId('toolbar-execute')).toBeEnabled({ timeout: APP_READY_MS })
  await page.getByTestId('toolbar-execute').click()
  await expect(page.getByTestId('result-toolbar')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('result-grid-view')).toBeVisible({ timeout: APP_READY_MS })
  const editModeDropdown = page.getByTestId('edit-mode-dropdown')
  await expect(editModeDropdown).toBeVisible({ timeout: APP_READY_MS })
  await editModeDropdown.click()
  await expect(page.getByRole('option')).toHaveCount(2, { timeout: APP_READY_MS })
  await page.getByRole('option').nth(1).click()
  await expect(editModeDropdown).not.toHaveText('Read Only', { timeout: APP_READY_MS })
  await expect(
    page.getByTestId('result-grid-view').locator('.rdg-editable-cell').first()
  ).toBeVisible({
    timeout: APP_READY_MS,
  })
}

async function getColumnIndexByName(grid: ReturnType<Page['locator']>, columnName: string) {
  const headerCells = grid.locator('.rdg-header-row .rdg-cell')
  const headerCount = await headerCells.count()

  for (let i = 0; i < headerCount; i++) {
    const text = await headerCells.nth(i).textContent()
    if (text?.trim() === columnName) {
      return i
    }
  }

  throw new Error(`Column "${columnName}" not found in header`)
}

async function getCellByColumnName(
  grid: ReturnType<Page['locator']>,
  rowIndex: number,
  columnName: string
) {
  const targetColIdx = await getColumnIndexByName(grid, columnName)

  const row = grid.locator('.rdg-row').nth(rowIndex)
  const cell = row.locator('.rdg-cell').nth(targetColIdx)
  await expect(cell).toBeVisible({ timeout: APP_READY_MS })
  return cell
}

async function getHeaderCellByColumnName(grid: ReturnType<Page['locator']>, columnName: string) {
  const targetColIdx = await getColumnIndexByName(grid, columnName)
  const cell = grid.locator('.rdg-header-row .rdg-cell').nth(targetColIdx)
  await expect(cell).toBeVisible({ timeout: APP_READY_MS })
  return cell
}

/**
 * Find a column header cell by name and click the corresponding body cell in a
 * given row. The app intentionally enables single-click editing via the grid's
 * custom onCellClick handler.
 */
async function clickCellByColumnName(
  grid: ReturnType<Page['locator']>,
  rowIndex: number,
  columnName: string
) {
  const cell = await getCellByColumnName(grid, rowIndex, columnName)
  await cell.click()
}

async function expectEditorKeepsFocusAcrossTyping(page: Page, text: string) {
  const editor = page.locator('.td-cell-editor-input').first()
  await expect(editor).toBeVisible({ timeout: APP_READY_MS })
  await expect(editor).toBeFocused()

  let expected = ''
  for (const char of text) {
    expected += char
    await page.keyboard.type(char)
    await expect(editor).toBeVisible({ timeout: APP_READY_MS })
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue(expected)
  }
}

test('editing a cell then clicking the next cell keeps editing on the clicked cell', async ({
  page,
}) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  // Wait for grid data to render (at least one row)
  await expect(grid.locator('.rdg-row').first()).toBeVisible({ timeout: APP_READY_MS })

  for (let index = 0; index < 3; index += 1) {
    // Click the name cell in the first row
    await clickCellByColumnName(grid, 0, 'name')

    const nameEditor = page.locator('.td-cell-editor-input').first()
    await expect(nameEditor).toBeVisible({ timeout: APP_READY_MS })
    await nameEditor.fill(`Julian Thorne ${index}`)

    // Click the email cell in the first row — transition editing to email
    await clickCellByColumnName(grid, 0, 'email')

    const emailEditor = page.locator('.td-cell-editor-input').first()
    await expect(emailEditor).toBeVisible({ timeout: APP_READY_MS })
    await expect(emailEditor).toBeEnabled()

    await emailEditor.fill(`julian-${index}@example.com`)
  }
})

test('table data grid editor keeps focus across multiple keypresses', async ({ page }) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid.locator('.rdg-row').first()).toBeVisible({ timeout: APP_READY_MS })

  await clickCellByColumnName(grid, 0, 'name')
  await expectEditorKeepsFocusAcrossTyping(page, 'Bob')
})

test('table data grid auto-sizes columns from visible data by default', async ({ page }) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid.locator('.rdg-row').first()).toBeVisible({ timeout: APP_READY_MS })

  const nameHeader = await getHeaderCellByColumnName(grid, 'name')
  const emailHeader = await getHeaderCellByColumnName(grid, 'email')

  const nameBox = await nameHeader.boundingBox()
  const emailBox = await emailHeader.boundingBox()

  expect(nameBox).not.toBeNull()
  expect(emailBox).not.toBeNull()
  expect(emailBox!.width).toBeGreaterThan(nameBox!.width)
})

test('table data datetime editor gives the input enough width for the full field value', async ({
  page,
}) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid.locator('.rdg-row').first()).toBeVisible({ timeout: APP_READY_MS })

  const createdAtCell = await getCellByColumnName(grid, 0, 'created_at')
  await createdAtCell.click()

  const editorInput = createdAtCell.locator('input.td-cell-editor-input')
  const calendarButton = createdAtCell.getByTestId('grid-calendar-btn')

  await expect(editorInput).toBeVisible({ timeout: APP_READY_MS })
  await expect(calendarButton).toBeVisible({ timeout: APP_READY_MS })

  const cellBox = await createdAtCell.boundingBox()
  const inputBox = await editorInput.boundingBox()

  expect(cellBox).not.toBeNull()
  expect(inputBox).not.toBeNull()
  expect(inputBox!.width).toBeGreaterThan(120)
  expect(inputBox!.width / cellBox!.width).toBeGreaterThan(0.55)
})

test('table data enum editor opens its dropdown and supports typeahead selection', async ({
  page,
}) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid.locator('.rdg-row').first()).toBeVisible({ timeout: APP_READY_MS })

  await clickCellByColumnName(grid, 0, 'status')

  const enumEditor = page.locator('.td-cell-editor-select').first()
  await expect(enumEditor).toBeVisible({ timeout: APP_READY_MS })
  await enumEditor.click()

  const listbox = page.getByRole('listbox', { name: 'status' })
  await expect(listbox).toBeVisible({ timeout: APP_READY_MS })

  await page.keyboard.type('i')
  await page.keyboard.press('Enter')

  const statusCell = await getCellByColumnName(grid, 0, 'status')
  await expect(statusCell).toContainText('inactive', { timeout: APP_READY_MS })
})

test('table data enum editor applies the clicked dropdown option', async ({ page }) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid.locator('.rdg-row').first()).toBeVisible({ timeout: APP_READY_MS })

  await clickCellByColumnName(grid, 0, 'status')

  const enumEditor = page.locator('.td-cell-editor-select').first()
  await expect(enumEditor).toBeVisible({ timeout: APP_READY_MS })
  await enumEditor.click()

  await page.getByRole('option', { name: 'inactive' }).click()

  const statusCell = await getCellByColumnName(grid, 0, 'status')
  await expect(statusCell).toContainText('inactive', { timeout: APP_READY_MS })
})

test('table data enum editor supports uppercase letter typeahead selection', async ({ page }) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid.locator('.rdg-row').first()).toBeVisible({ timeout: APP_READY_MS })

  await clickCellByColumnName(grid, 0, 'status')

  const enumEditor = page.locator('.td-cell-editor-select').first()
  await expect(enumEditor).toBeVisible({ timeout: APP_READY_MS })
  await enumEditor.click()

  await page.keyboard.type('I')
  await page.keyboard.press('Enter')

  const statusCell = await getCellByColumnName(grid, 0, 'status')
  await expect(statusCell).toContainText('inactive', { timeout: APP_READY_MS })
})

test('query result grid editor keeps focus across multiple keypresses', async ({ page }) => {
  await waitForApp(page)
  await openQueryEditorWithResults(page)

  const grid = page.getByTestId('result-grid-view')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid.locator('.rdg-row').first()).toBeVisible({ timeout: APP_READY_MS })

  await clickCellByColumnName(grid, 0, 'name')
  await expectEditorKeepsFocusAcrossTyping(page, 'Bob')
})

test('filter dialog — open, add conditions, apply, verify badge, and clear', async ({ page }) => {
  await waitForApp(page)
  await openTableDataTab(page)

  // Verify filter button exists
  const filterButton = page.getByTestId('btn-filter')
  await expect(filterButton).toBeVisible({ timeout: APP_READY_MS })

  // No badge initially
  await expect(page.getByTestId('filter-badge')).not.toBeVisible()

  // Open filter dialog
  await filterButton.click()
  await expect(page.getByTestId('filter-dialog')).toBeVisible({ timeout: APP_READY_MS })

  // Verify empty state is shown
  await expect(page.getByTestId('filter-empty-state')).toBeVisible()

  // Add a filter condition
  await page.getByTestId('filter-add-button').first().click()
  await expect(page.getByTestId('filter-row')).toBeVisible({ timeout: APP_READY_MS })

  // Verify the condition row has column select, operator select, value input
  await expect(page.getByTestId('filter-column-select-0')).toBeVisible()
  await expect(page.getByTestId('filter-operator-select-0')).toBeVisible()
  await expect(page.getByTestId('filter-value-input')).toBeVisible()

  // Set column to "name"
  await page.getByTestId('filter-column-select-0').click()
  await page.getByRole('option', { name: 'name', exact: true }).click()

  // Set operator to "LIKE"
  await page.getByTestId('filter-operator-select-0').click()
  await page.getByRole('option', { name: 'LIKE', exact: true }).click()

  // Set value
  await page.getByTestId('filter-value-input').fill('%Julian%')

  // Apply
  await page.getByTestId('filter-apply-button').click()

  // Dialog should close
  await expect(page.getByTestId('filter-dialog')).not.toBeVisible()

  // Badge should show "1"
  const badge = page.getByTestId('filter-badge')
  await expect(badge).toBeVisible({ timeout: APP_READY_MS })
  await expect(badge).toHaveText('1')

  // Re-open and add another condition
  await filterButton.click()
  await expect(page.getByTestId('filter-dialog')).toBeVisible({ timeout: APP_READY_MS })
  await page.getByTestId('filter-add-button').click()

  // Should now have 2 condition rows
  await expect(page.getByTestId('filter-row')).toHaveCount(2)

  // Apply again
  await page.getByTestId('filter-apply-button').click()
  await expect(page.getByTestId('filter-dialog')).not.toBeVisible()

  // Badge should show "2"
  await expect(badge).toHaveText('2')

  // Clear all filters
  await filterButton.click()
  await expect(page.getByTestId('filter-dialog')).toBeVisible({ timeout: APP_READY_MS })
  await page.getByTestId('filter-clear-all-button').click()

  // Apply the empty filter set
  await page.getByTestId('filter-apply-button').click()
  await expect(page.getByTestId('filter-dialog')).not.toBeVisible()

  // Badge should be gone
  await expect(page.getByTestId('filter-badge')).not.toBeVisible()
})
