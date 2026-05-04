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

export async function openConnectionManager(page: Page) {
  const btn = page.getByRole('button', { name: 'New Connection' }).first()
  const dialog = page.getByTestId('connection-dialog')

  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await dialog.isVisible())) await btn.click()

    try {
      await expect(dialog).toBeVisible({ timeout: 3_000 })
      break
    } catch (error) {
      if (attempt === 1) throw error
    }
  }

  await expect(dialog.getByText('Sample MySQL')).toBeVisible({ timeout: APP_READY_MS })
}

export async function selectSampleConnection(dialog: Locator) {
  const sampleRow = dialog.getByRole('button', { name: /Sample MySQL/ })
  await expect(sampleRow).toBeVisible({ timeout: APP_READY_MS })
  await sampleRow.scrollIntoViewIfNeeded()
  await expect(sampleRow).toBeEnabled({ timeout: APP_READY_MS })
  await sampleRow.click()
}

export async function dismissAllToasts(page: Page) {
  for (let i = 0; i < 8; i++) {
    const btn = page.getByTestId('toast-dismiss').first()
    if (!(await btn.isVisible().catch(() => false))) {
      break
    }
    await btn.click()
  }
}

export async function connectToSample(
  page: Page,
  options: {
    dismissToasts?: boolean
    waitForDatabaseNode?: boolean
  } = {}
) {
  const { dismissToasts = true, waitForDatabaseNode = true } = options

  await openConnectionManager(page)
  const dialog = page.getByTestId('connection-dialog')
  await selectSampleConnection(dialog)
  const connectBtn = dialog.getByRole('button', { name: 'Connect', exact: true })
  await expect(connectBtn).toBeEnabled({ timeout: APP_READY_MS })
  await connectBtn.click()
  await expect(page.getByTestId('connection-dialog')).toBeHidden({ timeout: APP_READY_MS })
  await expect(page.getByTestId('object-browser')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('status-bar')).toContainText('Connected', { timeout: APP_READY_MS })

  if (waitForDatabaseNode) {
    await expect(page.getByTestId('object-browser').getByText('ecommerce_db')).toBeVisible({
      timeout: APP_READY_MS,
    })
  }

  if (dismissToasts) {
    await dismissAllToasts(page)
  }
}

const AUTOCOMPLETE_OPEN_RETRIES = 5
const AUTOCOMPLETE_OPEN_TIMEOUT_MS = 3_000
const AUTOCOMPLETE_READY_RETRIES = 16
const AUTOCOMPLETE_RETRY_DELAY_MS = 250

async function focusMonacoEditor(page: Page, timeout = APP_READY_MS) {
  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout })
  await editorSurface.click({ position: { x: 160, y: 40 } })
  return editorSurface
}

async function readSuggestionLabels(suggestWidget: Locator) {
  return suggestWidget
    .locator('.monaco-list-row')
    .evaluateAll((rows) =>
      rows
        .map((row) => (row.getAttribute('aria-label') ?? row.textContent ?? '').trim())
        .filter((label) => label.length > 0)
    )
}

export async function waitForAutocomplete(
  page: Page,
  expectedText?: string,
  options: { allowNoWidget?: boolean } = {}
) {
  const suggestWidget = page.locator('.suggest-widget.visible')
  let lastLabels: string[] = []

  await page.waitForTimeout(300)
  const widgetAlreadyVisible = await suggestWidget.isVisible().catch(() => false)

  if (!widgetAlreadyVisible) {
    await focusMonacoEditor(page)
    await page.keyboard.press('Control+Space').catch(() => undefined)
  }

  for (let attempt = 0; attempt < AUTOCOMPLETE_OPEN_RETRIES; attempt++) {
    const isVisible = await suggestWidget
      .waitFor({ state: 'visible', timeout: AUTOCOMPLETE_OPEN_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false)

    if (!isVisible) {
      await focusMonacoEditor(page, AUTOCOMPLETE_OPEN_TIMEOUT_MS)
      await page.keyboard.press('Control+Space').catch(() => undefined)
      await page.waitForTimeout(AUTOCOMPLETE_RETRY_DELAY_MS)
      continue
    }

    for (let readyAttempt = 0; readyAttempt < AUTOCOMPLETE_READY_RETRIES; readyAttempt++) {
      const stillVisible = await suggestWidget.isVisible().catch(() => false)
      if (!stillVisible) {
        break
      }

      lastLabels = await readSuggestionLabels(suggestWidget)
      const labelsText = lastLabels.join(' ')
      const isLoading = labelsText.includes('Loading...')
      const hasExpectedText =
        !expectedText || lastLabels.some((label) => label.includes(expectedText))

      if (!isLoading && hasExpectedText) {
        return suggestWidget
      }

      await page.waitForTimeout(AUTOCOMPLETE_RETRY_DELAY_MS)
    }

    await page.keyboard.press('Escape').catch(() => undefined)
    await focusMonacoEditor(page, AUTOCOMPLETE_OPEN_TIMEOUT_MS)
    await page.keyboard.press('Control+Space').catch(() => undefined)
  }

  if (options.allowNoWidget) {
    return null
  }

  throw new Error(
    `Autocomplete did not become ready${lastLabels.length ? ` (last labels: ${lastLabels.join(' | ')})` : ''}`
  )
}
