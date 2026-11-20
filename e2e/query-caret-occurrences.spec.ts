import { test, expect, type Locator, type Page } from '@playwright/test'
import { waitForApp } from './helpers'
import { activePanel, openQueryEditorTab, typeQuery } from './query-editor-helpers'

const SEMIBOLD = '600'
const REGULAR = '400'

function fontWeightOf(word: Locator): Promise<string> {
  return word.evaluate((element) => getComputedStyle(element).fontWeight)
}

function backgroundOf(element: Locator): Promise<string> {
  return element.evaluate((node) => getComputedStyle(node).backgroundColor)
}

async function putCaretOnFirstId(page: Page): Promise<Locator> {
  await waitForApp(page)
  await openQueryEditorTab(page)
  await typeQuery(page, 'SELECT id, name FROM users WHERE id > 10')
  const idWords = activePanel(page).locator('.view-lines span span', { hasText: /^id$/ })
  await idWords.first().click()
  return idWords
}

function occurrenceFills(page: Page): Locator {
  return activePanel(page).locator('.view-overlays .cdr')
}

test('the other occurrences of the word under the caret turn semibold on a fill', async ({
  page,
}) => {
  const idWords = await putCaretOnFirstId(page)

  await expect.poll(() => fontWeightOf(idWords.last())).toBe(SEMIBOLD)
  expect(await fontWeightOf(idWords.first())).toBe(REGULAR)
  await expect(occurrenceFills(page)).toHaveCount(1)
})

test('the occurrence fill switches to its dark colour in the dark theme', async ({ page }) => {
  await putCaretOnFirstId(page)
  await expect(occurrenceFills(page)).toHaveCount(1)
  const lightFill = await backgroundOf(occurrenceFills(page))

  await page.getByTestId('theme-toggle').click()

  await expect.poll(() => backgroundOf(occurrenceFills(page))).not.toBe(lightFill)
})
