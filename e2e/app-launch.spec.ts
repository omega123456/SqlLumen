import { test, expect } from '@playwright/test'

test('app loads and has correct title', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/SqlLumen/)
})

test('layout sections are visible', async ({ page }) => {
  await page.goto('/')
  // Wait for layout to render
  await expect(page.getByText('Ready')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect to Sample MySQL' })).toBeVisible()
})

test('layout fits the window when zoomed in', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Ready')).toBeVisible()
  await page.evaluate(() => {
    document.documentElement.style.zoom = '150%'
  })

  const statusBar = await page.getByTestId('status-bar').boundingBox()
  const viewportHeight = page.viewportSize()!.height
  expect(statusBar!.y + statusBar!.height).toBeLessThanOrEqual(viewportHeight)
})
