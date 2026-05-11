import { test, expect, type Page } from '@playwright/test'
import {
  APP_READY_MS,
  clickResultGridHeader,
  connectToSample,
  waitForApp,
  waitForResultGrid,
} from './helpers'

async function openQueryEditorWithResults(page: Page) {
  await connectToSample(page)
  await page.getByTestId('new-query-tab-button').click()
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })
  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT * FROM users;')
  await page.keyboard.press('F9')
  await waitForResultGrid(page)
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

  const resultGrid = await waitForResultGrid(page)
  await clickResultGridHeader(page, 1)
  await expect(resultGrid.locator('canvas').first()).toBeVisible({ timeout: APP_READY_MS })
})
