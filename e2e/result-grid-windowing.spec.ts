/**
 * Windowed query results (functional, no screenshots): later pages load on
 * scroll, sort and clear-sort keep the original order, a filter shows
 * "x of y rows", and truncated results show the truncation notice.
 *
 * Rows come from the Playwright IPC mock, which serves windows over a view of
 * the fixture rows through the fixture registry (`query-results.ts`).
 */
import { test, expect, type Page } from '@playwright/test'
import {
  APP_READY_MS,
  connectToSample,
  getGridHeaderCellByColumnName,
  waitForApp,
  waitForResultGrid,
} from './helpers'

function activePanel(page: Page) {
  return page.locator('[data-testid="workspace-panel"][data-active="true"]')
}

async function runQuery(page: Page, sql: string) {
  await connectToSample(page)
  await expect(activePanel(page).getByTestId('query-editor-tab')).toBeVisible({
    timeout: APP_READY_MS,
  })
  const editorSurface = activePanel(page).locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })
  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type(sql)
  await page.keyboard.press('F9')
}

async function windowRequestOffsets(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const registry = (window as unknown as Record<string, unknown>)
      .__PLAYWRIGHT_FIXTURE_REGISTRY__ as {
      getResultWindowRequests: () => Array<{ offset: number }>
    }
    return registry.getResultWindowRequests().map((request) => request.offset)
  })
}

/** The first data row of the text view, read from the `<pre>` (header, separator, rows). */
async function firstTextRow(page: Page): Promise<string> {
  const text =
    (await activePanel(page).getByTestId('result-text-view').locator('pre').textContent()) ?? ''
  return text.split('\n')[2]?.trim() ?? ''
}

test.describe('windowed query results', () => {
  test('scrolling a large result loads later pages on demand', async ({ page }) => {
    await waitForApp(page)
    await runQuery(page, 'SELECT * FROM large_result;')
    const grid = await waitForResultGrid(page)
    await expect(activePanel(page).getByTestId('result-row-count')).toHaveText('12,340 rows')
    // The first window came with the result: no page fetch yet.
    expect(await windowRequestOffsets(page)).toEqual([])

    await grid.evaluate((element) => {
      const scroller =
        element.querySelector<HTMLElement>('.dvn-scroller') ?? (element as HTMLElement)
      scroller.scrollTop = scroller.scrollHeight / 2
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    await expect
      .poll(async () => Math.max(-1, ...(await windowRequestOffsets(page))), {
        timeout: APP_READY_MS,
      })
      .toBeGreaterThanOrEqual(5000)
    const offsets = await windowRequestOffsets(page)
    // 500-row pages, each requested once.
    expect(offsets.every((offset) => offset % 500 === 0)).toBe(true)
    expect(new Set(offsets).size).toBe(offsets.length)
  })

  test('sorting and clearing the sort keep the original order (no re-run)', async ({ page }) => {
    await waitForApp(page)
    await runQuery(page, 'SELECT * FROM large_result;')
    const grid = await waitForResultGrid(page)

    const idHeader = await getGridHeaderCellByColumnName(grid, 'id')
    await idHeader.click() // ASC
    await idHeader.click() // DESC

    await activePanel(page).getByTestId('view-mode-text').click()
    await expect
      .poll(() => firstTextRow(page), { timeout: APP_READY_MS })
      .toMatch(/^12340\s+Large user 12340/)
    await expect(activePanel(page).getByTestId('result-text-view-cap-strip')).toHaveText(
      /Showing first 5,000 of 12,340 rows in this view\./
    )
    await expect(activePanel(page).getByTestId('copy-all-button')).toHaveText('Copy first 5,000')

    await activePanel(page).getByTestId('view-mode-grid').click()
    const gridAgain = await waitForResultGrid(page)
    await (await getGridHeaderCellByColumnName(gridAgain, 'id')).click() // clear

    await activePanel(page).getByTestId('view-mode-text').click()
    await expect
      .poll(() => firstTextRow(page), { timeout: APP_READY_MS })
      .toMatch(/^1\s+Large user 00001/)
  })

  test('a filter shows "x of y rows" in the toolbar and the status bar', async ({ page }) => {
    await waitForApp(page)
    await runQuery(page, 'SELECT * FROM large_result;')
    await waitForResultGrid(page)

    await page.getByTestId('btn-filter').click()
    await expect(page.getByTestId('filter-dialog')).toBeVisible({ timeout: APP_READY_MS })
    await page.getByTestId('filter-add-button').first().click()
    await page.getByTestId('filter-column-select-0').click()
    await page.getByRole('option', { name: 'status', exact: true }).click()
    await page.getByTestId('filter-operator-select-0').click()
    await page.getByRole('option', { name: '==', exact: true }).click()
    await page.getByTestId('filter-value-input').fill('inactive')
    await page.getByTestId('filter-apply-button').click()

    // Every third row is inactive: 4,114 of 12,340.
    await expect(activePanel(page).getByTestId('result-row-count')).toHaveText(
      '4,114 of 12,340 rows',
      { timeout: APP_READY_MS }
    )
    await expect(page.getByTestId('query-rows')).toHaveText('4,114 of 12,340 rows')
  })

  test('a truncated re-runnable result shows the notice and "Export all rows…"', async ({
    page,
  }) => {
    await waitForApp(page)
    await runQuery(page, 'SELECT * FROM truncated_result;')
    await waitForResultGrid(page)

    const band = activePanel(page).getByTestId('result-truncation-band')
    await expect(band).toBeVisible({ timeout: APP_READY_MS })
    await expect(band).toHaveAttribute('role', 'status')
    await expect(band).toContainText('Showing the first 100,000 rows')
    await expect(band).toContainText(
      'Result truncated. This query returned more rows than the maximum rows kept per result.'
    )
    await expect(activePanel(page).getByTestId('result-row-count')).toHaveText(
      '100,000+ rows · truncated'
    )
    await expect(page.getByTestId('query-rows')).toHaveText('100,000+ rows · truncated')

    await band.getByTestId('truncation-export-all').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible({ timeout: APP_READY_MS })
  })

  test('a truncated CALL result explains why it cannot be exported in full', async ({ page }) => {
    await waitForApp(page)
    await runQuery(page, 'CALL sp_truncated_call();')
    await waitForResultGrid(page)

    const band = activePanel(page).getByTestId('result-truncation-band')
    await expect(band).toBeVisible({ timeout: APP_READY_MS })
    await expect(band).toContainText(
      'Exporting all rows would run this stored procedure again and repeat its changes.'
    )
    await expect(band.getByTestId('truncation-export-all')).toHaveCount(0)
  })

  test('deleting checked rows tombstones them in the cached result without a re-run', async ({
    page,
  }) => {
    await waitForApp(page)
    await runQuery(page, 'SELECT * FROM users;')
    await waitForResultGrid(page)
    await expect(activePanel(page).getByTestId('result-row-count')).toHaveText('5 rows')

    const editModeDropdown = activePanel(page).getByTestId('edit-mode-dropdown')
    await editModeDropdown.click()
    await page.getByRole('option').nth(1).click()
    await expect(editModeDropdown).not.toHaveText('Read only', { timeout: APP_READY_MS })

    // Check the first two rows (view range [0, 2)) through the store's real action.
    await page.evaluate(() => {
      const wsStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
        getState: () => { activeTabByConnection: Record<string, string | null> }
      }
      const queryStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
        getState: () => {
          setCheckedRanges: (tabId: string, ranges: Array<[number, number]>) => void
        }
      }
      const tabId = wsStore.getState().activeTabByConnection['session-playwright-1']
      if (!tabId) throw new Error('No active query tab')
      queryStore.getState().setCheckedRanges(tabId, [[0, 2]])
    })

    await activePanel(page).getByTestId('query-delete-rows-button').click()
    await expect(page.getByText('Delete 2 rows from users?')).toBeVisible()
    await page.getByTestId('confirm-confirm-button').click()

    await expect(activePanel(page).getByTestId('result-row-count')).toHaveText('3 rows', {
      timeout: APP_READY_MS,
    })
  })
})
