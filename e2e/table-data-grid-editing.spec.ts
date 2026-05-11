import { test, expect, type Page } from '@playwright/test'
import {
  APP_READY_MS,
  clickFkEllipsis,
  clickResultGridCell,
  clickResultGridHeader,
  connectToSample,
  getColumnIndexByName,
  getGridCellByColumnName,
  getGridHeaderCellByColumnName,
  waitForTableDataGrid,
  waitForApp,
} from './helpers'

async function expectCellValue(
  page: Page,
  gridTestId: 'table-data-grid' | 'result-grid',
  columnName: string,
  rowIndex: number,
  expectedValue: unknown
) {
  await expect
    .poll(
      async () =>
        page.evaluate(
          ({ grid, column, row }) => {
            if (grid === 'table-data-grid') {
              const store = (window as unknown as {
                __tableDataStore__?: {
                  getState?: () => {
                    tabs?: Record<string, { columns?: Array<{ name: string }>; rows?: unknown[][] }>
                  }
                }
              }).__tableDataStore__

              const tabs = Object.values(store?.getState?.().tabs ?? {})
              for (const tab of tabs) {
                const columnIndex = tab?.columns?.findIndex((candidate) => candidate?.name === column) ?? -1
                if (columnIndex >= 0) {
                  return tab?.rows?.[row]?.[columnIndex]
                }
              }
              return undefined
            }

            const store = (window as unknown as {
              __queryStore__?: {
                getState?: () => {
                  tabs?: Record<
                    string,
                    {
                      activeResultIndex?: number
                      results?: Array<{ columns?: Array<{ name: string }>; rows?: unknown[][] }>
                    }
                  >
                }
              }
            }).__queryStore__

            const tabs = Object.values(store?.getState?.().tabs ?? {})
            for (const tab of tabs) {
              const resultIndex = tab?.activeResultIndex ?? 0
              const result = tab?.results?.[resultIndex]
              const columnIndex = result?.columns?.findIndex((candidate) => candidate?.name === column) ?? -1
              if (columnIndex >= 0) {
                return result?.rows?.[row]?.[columnIndex]
              }
            }
            return undefined
          },
          { grid: gridTestId, column: columnName, row: rowIndex }
        ),
      { timeout: APP_READY_MS, intervals: [100, 200, 300] }
    )
    .toBe(expectedValue)
}

async function expectSelectedTableDataColumn(page: Page, columnName: string) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const store = (window as unknown as {
            __tableDataStore__?: {
              getState?: () => {
                tabs?: Record<string, { selectedCell?: { columnKey?: string } | null }>
              }
            }
          }).__tableDataStore__

          const tabs = Object.values(store?.getState?.().tabs ?? {})
          return tabs.find((tab) => tab?.selectedCell?.columnKey)?.selectedCell?.columnKey ?? null
        }),
      { timeout: APP_READY_MS, intervals: [100, 200, 300] }
    )
    .toBe(columnName)
}

async function openTableDataTab(page: Page) {
  await connectToSample(page)

  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { openTab: (tab: Record<string, unknown>) => void }
    }
    store.getState().openTab({
      type: 'table-data',
      label: 'sample_table',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'sample_table',
      objectType: 'table',
    })
  })

  await expect(page.getByTestId('table-data-tab')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('pagination-page-input')).toHaveValue('1', {
    timeout: APP_READY_MS,
  })
  await expect(page.getByTestId('table-data-grid')).toBeVisible({
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

  await expect(page.getByTestId('toolbar-execute-all')).toBeEnabled({ timeout: APP_READY_MS })
  await page.keyboard.press('F9')
  await expect(page.getByTestId('result-toolbar')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('result-grid')).toBeVisible({ timeout: APP_READY_MS })
  const editModeDropdown = page.getByTestId('edit-mode-dropdown')
  await expect(editModeDropdown).toBeVisible({ timeout: APP_READY_MS })
  await editModeDropdown.click()
  await expect(page.getByRole('option')).toHaveCount(2, { timeout: APP_READY_MS })
  await page.getByRole('option').nth(1).click()
  await expect(editModeDropdown).not.toHaveText('Read Only', { timeout: APP_READY_MS })
  await expect(page.getByTestId('result-grid')).toBeVisible({
    timeout: APP_READY_MS,
  })
}

async function getCellByColumnName(
  grid: ReturnType<Page['locator']>,
  rowIndex: number,
  columnName: string
) {
  return getGridCellByColumnName(grid, rowIndex, columnName)
}

async function getHeaderCellByColumnName(grid: ReturnType<Page['locator']>, columnName: string) {
  return getGridHeaderCellByColumnName(grid, columnName)
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
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

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
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  await clickCellByColumnName(grid, 0, 'name')
  await expectEditorKeepsFocusAcrossTyping(page, 'Bob')
})

test('table data grid auto-sizes columns from visible data by default', async ({ page }) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  const nameHeader = await getHeaderCellByColumnName(grid, 'name')
  const emailHeader = await getHeaderCellByColumnName(grid, 'email')

  const nameBox = await nameHeader.boundingBox()
  const emailBox = await emailHeader.boundingBox()

  expect(nameBox).not.toBeNull()
  expect(emailBox).not.toBeNull()
  expect(emailBox!.width).toBeGreaterThan(nameBox!.width)
})

test('table data FK header width survives form-to-grid switching without runtime errors', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })

  await waitForApp(page)
  await connectToSample(page)

  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { openTab: (tab: Record<string, unknown>) => void }
    }
    store.getState().openTab({
      type: 'table-data',
      label: 'orders',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'orders',
      objectType: 'table',
    })
  })

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await page.waitForTimeout(500)

  const beforeHeader = await getHeaderCellByColumnName(grid, 'user_id')
  const beforeBox = await beforeHeader.boundingBox()

  expect(beforeBox).not.toBeNull()
  expect(beforeBox!.width).toBeGreaterThan(120)

  await page.getByTestId('view-mode-form').click()
  await expect(page.getByTestId('table-data-form-view')).toBeVisible({ timeout: APP_READY_MS })

  await page.getByTestId('form-input-user_id').click()
  await page.getByTestId('form-input-status').click()

  await page.getByTestId('view-mode-grid').click()
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  const afterHeader = await getHeaderCellByColumnName(grid, 'user_id')
  const afterBox = await afterHeader.boundingBox()

  expect(afterBox).not.toBeNull()
  expect(Math.round(afterBox!.width)).toBe(Math.round(beforeBox!.width))
  expect(pageErrors).toEqual([])
})

test('table data datetime editor gives the input enough width for the full field value', async ({
  page,
}) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  const createdAtCell = await getCellByColumnName(grid, 0, 'created_at')
  await createdAtCell.click()

  const editorInput = page.locator('input.td-cell-editor-input').first()
  const calendarButton = page.getByTestId('grid-calendar-btn')

  await expect(editorInput).toBeVisible({ timeout: APP_READY_MS })
  await expect(calendarButton).toBeVisible({ timeout: APP_READY_MS })

  const cellBox = await createdAtCell.boundingBox()
  const inputBox = await editorInput.boundingBox()

  expect(cellBox).not.toBeNull()
  expect(inputBox).not.toBeNull()
  expect(inputBox!.width).toBeGreaterThan(120)
  expect(inputBox!.width / cellBox!.width).toBeGreaterThan(0.55)
})

test('table data enum editor fills the cell height and gives options comfortable sizing', async ({
  page,
}) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  const statusCell = await getCellByColumnName(grid, 0, 'status')
  await statusCell.click()

  const enumEditor = page.locator('.td-cell-editor-select').first()
  await expect(enumEditor).toBeVisible({ timeout: APP_READY_MS })

  const cellBox = await statusCell.boundingBox()
  const editorBox = await enumEditor.boundingBox()

  expect(cellBox).not.toBeNull()
  expect(editorBox).not.toBeNull()
  expect(editorBox!.height).toBeGreaterThan(21)
  expect(editorBox!.height / cellBox!.height).toBeGreaterThan(0.7)

  await enumEditor.click()

  const listbox = page.getByRole('listbox', { name: 'status' })
  await expect(listbox).toBeVisible({ timeout: APP_READY_MS })

  const activeOption = page.getByRole('option', { name: 'active', exact: true })
  await expect(activeOption).toBeVisible({ timeout: APP_READY_MS })

  const optionBox = await activeOption.boundingBox()
  expect(optionBox).not.toBeNull()
  expect(optionBox!.height).toBeGreaterThan(21)
})

test('table data enum editor opens its dropdown and supports typeahead selection', async ({
  page,
}) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  await clickCellByColumnName(grid, 0, 'status')

  const enumEditor = page.locator('.td-cell-editor-select').first()
  await expect(enumEditor).toBeVisible({ timeout: APP_READY_MS })
  await enumEditor.click()

  const listbox = page.getByRole('listbox', { name: 'status' })
  await expect(listbox).toBeVisible({ timeout: APP_READY_MS })

  await page.keyboard.type('i')
  await page.keyboard.press('Enter')

  await expectCellValue(page, 'table-data-grid', 'status', 0, 'inactive')
})

test('table data enum editor applies the clicked dropdown option', async ({ page }) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  await clickCellByColumnName(grid, 0, 'status')

  const enumEditor = page.locator('.td-cell-editor-select').first()
  await expect(enumEditor).toBeVisible({ timeout: APP_READY_MS })
  await enumEditor.click()

  await page.getByRole('option', { name: 'inactive' }).click()

  await expectCellValue(page, 'table-data-grid', 'status', 0, 'inactive')
})

test('table data enum editor supports uppercase letter typeahead selection', async ({ page }) => {
  await waitForApp(page)
  await openTableDataTab(page)

  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  await clickCellByColumnName(grid, 0, 'status')

  const enumEditor = page.locator('.td-cell-editor-select').first()
  await expect(enumEditor).toBeVisible({ timeout: APP_READY_MS })
  await enumEditor.click()

  await page.keyboard.type('I')
  await page.keyboard.press('Enter')

  await expectCellValue(page, 'table-data-grid', 'status', 0, 'inactive')
})

test('query result grid editor keeps focus across multiple keypresses', async ({ page }) => {
  await waitForApp(page)
  await openQueryEditorWithResults(page)

  const grid = page.getByTestId('result-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  await clickCellByColumnName(grid, 0, 'name')
  await expectEditorKeepsFocusAcrossTyping(page, 'Bob')
})

test('query result grid keeps read-only header icon width when edit mode turns on', async ({
  page,
}) => {
  await waitForApp(page)
  await openQueryEditorWithResults(page)

  const grid = page.getByTestId('result-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  const statusHeader = await getHeaderCellByColumnName(grid, 'status')
  const statusBox = await statusHeader.boundingBox()

  expect(statusBox).not.toBeNull()
  expect(statusBox!.width).toBeGreaterThan(120)
})

test('query result grid supports keyboard navigation, copy, edit cancel, and tab commit', async ({
  page,
}) => {
  await waitForApp(page)
  await openQueryEditorWithResults(page)

  const grid = page.getByTestId('result-grid')
  await expect(grid.locator('canvas').first()).toBeVisible({ timeout: APP_READY_MS })

  await clickResultGridCell(page, 1, 0)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C')
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  expect(copied.length).toBeGreaterThan(0)

  await clickCellByColumnName(page.getByTestId('result-grid'), 0, 'name')
  const editor = page.locator('.td-cell-editor-input').first()
  await expect(editor).toBeVisible({ timeout: APP_READY_MS })
  await editor.fill('Cancelled Value')
  await page.keyboard.press('Escape')
  await expect(editor).not.toBeVisible({ timeout: APP_READY_MS })

  await clickCellByColumnName(page.getByTestId('result-grid'), 0, 'name')
  const commitEditor = page.locator('.td-cell-editor-input').first()
  await expect(commitEditor).toBeVisible({ timeout: APP_READY_MS })
  await commitEditor.fill('Committed Value')
  await page.keyboard.press('Tab')
  await expect(commitEditor).not.toBeVisible({ timeout: APP_READY_MS })
})

test('result grid header clicks cycle sort ascending, descending, and clear', async ({ page }) => {
  await waitForApp(page)
  await openQueryEditorWithResults(page)

  await clickResultGridHeader(page, 1)
  await expect(page.getByTestId('result-grid').locator('canvas').first()).toBeVisible({
    timeout: APP_READY_MS,
  })
  await clickResultGridHeader(page, 1)
  await expect(page.getByTestId('result-grid').locator('canvas').first()).toBeVisible({
    timeout: APP_READY_MS,
  })
  await clickResultGridHeader(page, 1)
  await expect(page.getByTestId('result-grid').locator('canvas').first()).toBeVisible({
    timeout: APP_READY_MS,
  })
})

test('table data FK lookup opens from ellipsis click and F4 shortcut', async ({ page }) => {
  await waitForApp(page)
  await connectToSample(page)

  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { openTab: (tab: Record<string, unknown>) => void }
    }
    store.getState().openTab({
      type: 'table-data',
      label: 'orders',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'orders',
      objectType: 'table',
    })
  })

  const grid = await waitForTableDataGrid(page)
  const userIdColumn = await getColumnIndexByName(grid, 'user_id')
  await clickFkEllipsis(page, userIdColumn, 0)
  await expect(page.getByTestId('fk-lookup-dialog')).toBeVisible({ timeout: APP_READY_MS })
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('fk-lookup-dialog')).not.toBeVisible({ timeout: APP_READY_MS })

  await clickCellByColumnName(grid, 0, 'user_id')
  await expectSelectedTableDataColumn(page, 'user_id')
  await page.keyboard.press('F4')
  await expect(page.getByTestId('fk-lookup-dialog')).toBeVisible({ timeout: APP_READY_MS })
})

test('query result form-to-grid switch keeps header widths and avoids runtime errors', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })

  await waitForApp(page)
  await openQueryEditorWithResults(page)

  const grid = page.getByTestId('result-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  const beforeHeader = await getHeaderCellByColumnName(grid, 'status')
  const beforeBox = await beforeHeader.boundingBox()

  expect(beforeBox).not.toBeNull()

  await page.getByTestId('view-mode-form').click()
  await expect(page.getByTestId('result-form-view')).toBeVisible({ timeout: APP_READY_MS })

  await page.getByTestId('form-input-id').click()
  await page.getByTestId('form-input-name').click()

  await page.getByTestId('view-mode-grid').click()
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })

  const afterHeader = await getHeaderCellByColumnName(grid, 'status')
  const afterBox = await afterHeader.boundingBox()

  expect(afterBox).not.toBeNull()
  expect(Math.round(afterBox!.width)).toBe(Math.round(beforeBox!.width))
  expect(pageErrors).toEqual([])
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
