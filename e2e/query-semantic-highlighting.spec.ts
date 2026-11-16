import { test, expect, type Page } from '@playwright/test'
import { APP_READY_MS, waitForApp, waitForSemanticHighlighting } from './helpers'
import { activePanel, openQueryEditorTab, typeQuery } from './query-editor-helpers'

function warningSquiggles(page: Page) {
  return activePanel(page).locator('.squiggly-warning')
}

async function showHoverOnWord(page: Page, word: string) {
  await expect(warningSquiggles(page)).toHaveCount(1, { timeout: APP_READY_MS })
  await activePanel(page).locator('.view-lines span', { hasText: word }).last().click()
  await page.keyboard.press('Control+K')
  await page.keyboard.press('Control+I')
  const hover = page.locator('.monaco-hover:not(.hidden)')
  await expect(hover).toBeVisible({ timeout: APP_READY_MS })
  return hover
}

test.describe('Monaco SQL semantic highlighting', () => {
  test('warns about an unknown table on hover', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)
    await typeQuery(page, 'SELECT * FROM no_such_table')
    await waitForSemanticHighlighting(activePanel(page))

    const hover = await showHoverOnWord(page, 'no_such_table')

    await expect(hover).toContainText('Unknown table `ecommerce_db.no_such_table`')
  })

  test('warns about an unknown qualified column on hover', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)
    await typeQuery(page, 'SELECT u.no_such_col FROM users u')
    await waitForSemanticHighlighting(activePanel(page))

    const hover = await showHoverOnWord(page, 'no_such_col')

    await expect(hover).toContainText('Unknown column `no_such_col` in `users`')
  })

  test('flags only the unknown column of a query that also uses a valid one', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)
    await typeQuery(page, 'SELECT u.email, u.emial FROM users u')
    await waitForSemanticHighlighting(activePanel(page))

    const hover = await showHoverOnWord(page, 'emial')

    await expect(hover).toContainText('Unknown column `emial` in `users`')
    await expect(hover).not.toContainText('`email`')
  })
})
