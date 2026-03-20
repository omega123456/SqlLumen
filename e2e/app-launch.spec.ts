import { test, expect } from '@playwright/test'

test('app loads and has correct title', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/MySQL Client/)
})

test('layout sections are visible', async ({ page }) => {
  await page.goto('/')
  // Wait for layout to render
  await expect(page.getByText('Ready')).toBeVisible()
  await expect(page.getByText('No active connection')).toBeVisible()
  await expect(page.getByText('Welcome!')).toBeVisible()
})
