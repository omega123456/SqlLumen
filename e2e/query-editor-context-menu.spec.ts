import { expect, test } from '@playwright/test'
import { waitForApp } from './helpers'
import { activePanel, openQueryEditorTab } from './query-editor-helpers'

const TRANSPARENT = 'rgba(0, 0, 0, 0)'

test('the editor context menu has an opaque themed background', async ({ page }) => {
  await waitForApp(page)
  await openQueryEditorTab(page)

  await activePanel(page).locator('.monaco-editor .view-lines').first().click({ button: 'right' })

  const menuSurface = page.locator('.monaco-menu-container > .monaco-scrollable-element').first()
  await expect(menuSurface).toBeVisible()
  const background = await menuSurface.evaluate(
    (element) => window.getComputedStyle(element).backgroundColor
  )
  expect(background).not.toBe(TRANSPARENT)
})
