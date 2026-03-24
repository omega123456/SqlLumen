import { test, expect, type Page } from '@playwright/test'

const APP_READY_MS = 60_000
const SUGGESTION_SETTLE_MS = 500

const MALFORMED_SCHEMA_METADATA = {
  databases: ['valid_db', ''],
  tables: {
    valid_db: [
      {
        name: 'users',
        engine: 'InnoDB',
        charset: 'utf8mb4',
        rowCount: 42,
        dataSize: 1024,
      },
      {
        name: '   ',
        engine: 'InnoDB',
        charset: 'utf8mb4',
        rowCount: 0,
        dataSize: 0,
      },
      null,
    ],
    '': [
      {
        name: '',
        engine: 'InnoDB',
        charset: 'utf8mb4',
        rowCount: 0,
        dataSize: 0,
      },
    ],
  },
  columns: {
    'valid_db.users': [
      { name: 'id', dataType: 'BIGINT' },
      { name: 'email', dataType: 'VARCHAR' },
      { name: '   ', dataType: 'VARCHAR' },
      null,
    ],
    '.': [
      { name: '', dataType: 'BIGINT' },
      { name: '', dataType: 'VARCHAR' },
    ],
    'broken.container': null,
  },
  routines: {
    valid_db: [{ name: 'get_users', routineType: 'FUNCTION' }],
    '': [{ name: '', routineType: 'FUNCTION' }],
    broken_container: null,
  },
}

async function waitForApp(page: Page) {
  await page.goto('/', { waitUntil: 'load', timeout: APP_READY_MS })
  await expect(page.getByTestId('app-layout')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('status-bar')).toContainText('Ready', { timeout: APP_READY_MS })
}

async function openConnectionManager(page: Page) {
  await page.getByRole('button', { name: 'New Connection' }).first().click()
  await expect(page.getByTestId('connection-dialog')).toBeVisible()
  await expect(page.getByText('Sample MySQL')).toBeVisible()
}

async function connectToSample(page: Page) {
  await openConnectionManager(page)
  await page.getByText('Sample MySQL').click()
  await page
    .getByTestId('connection-dialog')
    .getByRole('button', { name: 'Connect', exact: true })
    .click()
  await expect(page.getByTestId('connection-dialog')).toBeHidden()
  await expect(page.getByTestId('object-browser')).toBeVisible()
}

async function openQueryEditorTab(page: Page) {
  await connectToSample(page)
  await page.getByTestId('new-query-tab-button').click()
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
}

async function injectMalformedSchemaMetadata(page: Page) {
  await page.evaluate((schemaMetadata) => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__?: {
          invoke?: (
            cmd: string,
            args?: Record<string, unknown>,
            options?: unknown
          ) => Promise<unknown>
        }
      }
    ).__TAURI_INTERNALS__

    if (!internals?.invoke) {
      throw new Error('Tauri invoke mock is not installed')
    }

    const originalInvoke = internals.invoke
    internals.invoke = async (cmd: string, args?: Record<string, unknown>, options?: unknown) => {
      if (cmd === 'fetch_schema_metadata') {
        return schemaMetadata
      }

      return originalInvoke(cmd, args, options)
    }
  }, MALFORMED_SCHEMA_METADATA)
}

test('autocomplete ignores malformed schema metadata instead of emitting invalid Monaco items', async ({
  page,
}) => {
  test.setTimeout(APP_READY_MS)

  const invalidCompletionWarnings: string[] = []

  page.on('console', (msg) => {
    if (msg.type() !== 'warning') {
      return
    }

    const text = msg.text()
    if (text.includes('did IGNORE invalid completion item')) {
      invalidCompletionWarnings.push(text)
    }
  })

  await waitForApp(page)

  await injectMalformedSchemaMetadata(page)

  await openQueryEditorTab(page)

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })

  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT * FROM valid_db.')

  await expect(page.locator('.suggest-widget.visible')).toContainText('users')
  await page.waitForTimeout(SUGGESTION_SETTLE_MS)

  expect(invalidCompletionWarnings).toEqual([])
})

test('alias completion: FROM users t → t. suggests users columns', async ({ page }) => {
  test.setTimeout(APP_READY_MS)

  await waitForApp(page)
  await openQueryEditorTab(page)

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })

  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT * FROM users t WHERE t.')

  const suggestWidget = page.locator('.suggest-widget.visible')
  await expect(suggestWidget).toBeVisible({ timeout: 10_000 })

  // Verify the suggestions include column names from the users table
  await expect(suggestWidget).toContainText('id')
  await expect(suggestWidget).toContainText('email')
  await expect(suggestWidget).toContainText('name')
  await page.waitForTimeout(SUGGESTION_SETTLE_MS)
})

test('alias completion: FROM analytics_db.events e → e. suggests events columns', async ({
  page,
}) => {
  test.setTimeout(APP_READY_MS)

  await waitForApp(page)
  await openQueryEditorTab(page)

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })

  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT * FROM analytics_db.events e WHERE e.')

  const suggestWidget = page.locator('.suggest-widget.visible')
  await expect(suggestWidget).toBeVisible({ timeout: 10_000 })

  // Verify the suggestions include column names from analytics_db.events
  await expect(suggestWidget).toContainText('event_name')
  await expect(suggestWidget).toContainText('user_id')
  await expect(suggestWidget).toContainText('created_at')
  await page.waitForTimeout(SUGGESTION_SETTLE_MS)
})

test('context-aware ranking: WHERE clause → columns ranked above keywords', async ({ page }) => {
  test.setTimeout(APP_READY_MS)

  await waitForApp(page)
  await openQueryEditorTab(page)

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })

  // Type a WHERE query — the space after WHERE triggers column context
  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT * FROM users WHERE ')

  // Explicitly trigger autocomplete since typing space may not auto-trigger
  await page.keyboard.press('Control+Space')

  const suggestWidget = page.locator('.suggest-widget.visible')
  await expect(suggestWidget).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(SUGGESTION_SETTLE_MS)

  // Get ordered list of suggestion labels from the widget rows.
  // Monaco renders suggestions as role="option" elements with aria-label.
  const optionLabels = await suggestWidget
    .locator('.monaco-list-row')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label') ?? r.textContent ?? ''))

  // Columns from users table in the mock: id, name, email, status, created_at
  const columnNames = ['id', 'name', 'email', 'status', 'created_at']
  const keywordNames = ['AND', 'OR', 'SELECT', 'FROM', 'WHERE', 'LIMIT', 'LIKE']

  // Find the first column and first keyword positions in the list
  const firstColumnIndex = optionLabels.findIndex((label) =>
    columnNames.some((col) => label.toLowerCase().includes(col.toLowerCase()))
  )
  const firstKeywordIndex = optionLabels.findIndex((label) =>
    keywordNames.some((kw) => label.toLowerCase().includes(kw.toLowerCase()))
  )

  // Columns should appear in the list
  expect(firstColumnIndex).toBeGreaterThanOrEqual(0)

  // If both columns and keywords are visible, columns should come first
  if (firstKeywordIndex >= 0) {
    expect(firstColumnIndex).toBeLessThan(firstKeywordIndex)
  }
})
