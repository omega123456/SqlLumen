import { test, expect, type Page } from '@playwright/test'

const APP_READY_MS = 5_000

async function waitForApp(page: Page) {
  await page.goto('/', { waitUntil: 'load', timeout: APP_READY_MS })
  await expect(page.getByTestId('app-layout')).toBeVisible({ timeout: APP_READY_MS })
}

async function connectToSample(page: Page) {
  await page.getByRole('button', { name: 'New Connection' }).first().click()
  await expect(page.getByTestId('connection-dialog')).toBeVisible()
  await page
    .getByTestId('connection-dialog')
    .getByRole('button', { name: /Sample MySQL/ })
    .click()
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

test('result grid renders Phosphor sort arrow icons when column is sorted', async ({ page }) => {
  test.setTimeout(APP_READY_MS * 3)

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

    queryStore.setState((state) => {
      const tab = state.tabs[activeTabId] as {
        results: Array<Record<string, unknown>>
        [key: string]: unknown
      }
      const updatedResults = tab.results.map((r, i) =>
        i === 0 ? { ...r, sortColumn: 'name', sortDirection: 'asc' } : r
      )
      return {
        tabs: {
          ...state.tabs,
          [activeTabId]: {
            ...tab,
            results: updatedResults,
          },
        },
      }
    })
  })

  // react-data-grid uses a custom SortStatusRenderer that renders a Phosphor ArrowUp SVG
  // for ASC sort direction. The ArrowUp icon is inside the header sort cell.
  const resultGrid = page.getByTestId('result-grid-view')
  const sortArrowUp = resultGrid.locator('.rdg-header-row svg').first()
  await expect(sortArrowUp).toBeVisible({ timeout: APP_READY_MS })

  // Verify react-data-grid grid structure is present
  const headerRow = resultGrid.locator('.rdg-header-row')
  await expect(headerRow).toBeVisible({ timeout: APP_READY_MS })

  const dataRows = resultGrid.locator('.rdg-row')
  await expect(dataRows.first()).toBeVisible({ timeout: APP_READY_MS })
})
