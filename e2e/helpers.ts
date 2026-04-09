import { expect, type Locator, type Page } from '@playwright/test'

export const APP_READY_MS = 5_000

const APP_BOOT_ATTEMPTS = 3
const GOTO_RETRY_ATTEMPTS = 2
const GOTO_RETRY_DELAY_MS = 500

export async function waitForApp(page: Page) {
  for (let appAttempt = 0; appAttempt < APP_BOOT_ATTEMPTS; appAttempt++) {
    try {
      for (let gotoAttempt = 0; gotoAttempt < GOTO_RETRY_ATTEMPTS; gotoAttempt++) {
        try {
          await page.goto('/', { waitUntil: 'load', timeout: APP_READY_MS })
          break
        } catch (error) {
          if (gotoAttempt === GOTO_RETRY_ATTEMPTS - 1) {
            throw error
          }

          await page.waitForTimeout(GOTO_RETRY_DELAY_MS)
        }
      }

      await expect(page.getByTestId('app-layout')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('status-bar')).toContainText('Ready', {
        timeout: APP_READY_MS,
      })
      await page.evaluate(() => document.fonts.ready)
      return
    } catch (error) {
      if (appAttempt === APP_BOOT_ATTEMPTS - 1) {
        throw error
      }

      await page.waitForTimeout(GOTO_RETRY_DELAY_MS)
    }
  }
}

export async function getColumnIndexByName(grid: Locator, columnName: string) {
  const headerCells = grid.locator('.rdg-header-row .rdg-cell')
  const headerCount = await headerCells.count()

  for (let i = 0; i < headerCount; i++) {
    const text = await headerCells.nth(i).textContent()
    if (text?.trim() === columnName) {
      return i
    }
  }

  throw new Error(`Column "${columnName}" not found in header`)
}

export async function getGridCellByColumnName(grid: Locator, rowIndex: number, columnName: string) {
  const targetColIdx = await getColumnIndexByName(grid, columnName)
  const row = grid.locator('.rdg-row').nth(rowIndex)
  const cell = row.locator('.rdg-cell').nth(targetColIdx)
  await expect(cell).toBeVisible({ timeout: APP_READY_MS })
  return cell
}

export async function getGridHeaderCellByColumnName(grid: Locator, columnName: string) {
  const targetColIdx = await getColumnIndexByName(grid, columnName)
  const cell = grid.locator('.rdg-header-row .rdg-cell').nth(targetColIdx)
  await expect(cell).toBeVisible({ timeout: APP_READY_MS })
  return cell
}
