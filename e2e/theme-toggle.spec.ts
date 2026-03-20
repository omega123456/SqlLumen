import { test, expect } from '@playwright/test'

test('theme toggle switches between light and dark', async ({ page }) => {
  await page.goto('/')

  // Wait for app to load
  await expect(page.getByText('Ready')).toBeVisible()

  // Get initial theme state
  const initialTheme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  )

  // Click the theme toggle
  await page.getByTestId('theme-toggle').click()

  // Theme should have changed
  const newTheme = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  )

  expect(newTheme).not.toBe(initialTheme)
})
