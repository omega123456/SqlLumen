import { test, expect, type Page } from '@playwright/test'

const APP_READY_MS = 60_000

async function waitForApp(page: Page) {
  await page.goto('/', { waitUntil: 'load', timeout: APP_READY_MS })
  await expect(page.getByTestId('app-layout')).toBeVisible({ timeout: APP_READY_MS })
}

async function connectToSample(page: Page) {
  await page.getByRole('button', { name: 'New Connection' }).first().click()
  await expect(page.getByTestId('connection-dialog')).toBeVisible()
  await page.getByText('Sample MySQL').click()
  await page
    .getByTestId('connection-dialog')
    .getByRole('button', { name: 'Connect', exact: true })
    .click()
  await expect(page.getByTestId('connection-dialog')).toBeHidden()
  await expect(page.getByTestId('object-browser')).toBeVisible()
}

async function openQueryEditorWithResults(page: Page) {
  await connectToSample(page)
  await page.getByTestId('new-query-tab-button').click()
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })
  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT * FROM users;')
  await page.getByTestId('toolbar-execute').click()
  await expect(page.getByTestId('result-grid-view')).toBeVisible({ timeout: APP_READY_MS })
}

test('result grid wires an AG Grid icon font so sort indicators render', async ({ page }) => {
  test.setTimeout(APP_READY_MS)

  await waitForApp(page)
  await openQueryEditorWithResults(page)

  await page.evaluate(() => {
    const wsStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => {
        activeTabByConnection: Record<string, string | null>
      }
    }
    const queryStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
      setState: (
        updater: (state: { tabs: Record<string, Record<string, unknown>> }) => {
          tabs: Record<string, Record<string, unknown>>
        }
      ) => void
    }

    const activeTabId = wsStore.getState().activeTabByConnection['session-playwright-1']
    if (!activeTabId) {
      throw new Error('No active query tab found for sort icon test')
    }

    queryStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        [activeTabId]: {
          ...state.tabs[activeTabId],
          sortColumn: 'name',
          sortDirection: 'asc',
        },
      },
    }))
  })

  const visibleAscendingIcon = page
    .getByTestId('result-grid-view')
    .locator('.ag-sort-ascending-icon:not(.ag-hidden)')
    .first()
  await expect(visibleAscendingIcon).toBeVisible({ timeout: APP_READY_MS })

  const iconFontFamily = await page.getByTestId('result-grid-view').evaluate((el) => {
    return getComputedStyle(el).getPropertyValue('--ag-icon-font-family').trim()
  })

  expect(iconFontFamily).toBeTruthy()
})
