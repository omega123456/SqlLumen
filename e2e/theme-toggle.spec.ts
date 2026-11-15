import { test, expect } from '@playwright/test'
import { currentTheme } from './helpers'

test('theme toggle switches between light and dark', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('Ready')).toBeVisible()

  const initialTheme = await currentTheme(page)

  await page.getByTestId('theme-toggle').click()

  const newTheme = await currentTheme(page)

  expect(newTheme).not.toBe(initialTheme)
})
