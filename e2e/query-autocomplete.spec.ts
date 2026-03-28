import { test, expect, type Page } from '@playwright/test'

const APP_READY_MS = 60_000
const SUGGESTION_SETTLE_MS = 500
const AUTOCOMPLETE_OPEN_RETRIES = 8
const AUTOCOMPLETE_OPEN_TIMEOUT_MS = 10_000
const AUTOCOMPLETE_RETRY_DELAY_MS = 300

function trackSqlParserConsoleErrors(page: Page) {
  const errors: string[] = []

  page.on('console', (msg) => {
    if (msg.type() !== 'error') {
      return
    }

    const text = msg.text()
    if (text.includes('no viable alternative at input') || text.includes('extraneous input')) {
      errors.push(text)
    }
  })

  return errors
}

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
  await expect(page.getByTestId('object-browser')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('status-bar')).toContainText('Connected', { timeout: APP_READY_MS })
}

async function openQueryEditorTab(page: Page) {
  await connectToSample(page)
  await page.getByTestId('new-query-tab-button').click()
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
}

async function openAutocomplete(page: Page, expectedText?: string) {
  const suggestWidget = page.locator('.suggest-widget.visible')

  for (let attempt = 0; attempt < AUTOCOMPLETE_OPEN_RETRIES; attempt++) {
    await page.keyboard.press('Control+Space')

    const isVisible = await expect(suggestWidget)
      .toBeVisible({ timeout: AUTOCOMPLETE_OPEN_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false)

    if (!isVisible) {
      await page.waitForTimeout(AUTOCOMPLETE_RETRY_DELAY_MS)
      continue
    }

    const text = (await suggestWidget.textContent()) ?? ''
    if (!text.includes('Loading...') && (!expectedText || text.includes(expectedText))) {
      return suggestWidget
    }

    await page.waitForTimeout(AUTOCOMPLETE_RETRY_DELAY_MS)
  }

  return suggestWidget
}

async function selectDatabaseInObjectBrowser(page: Page, databaseName: string) {
  await page.getByText(databaseName).first().click()
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

  const suggestWidget = await openAutocomplete(page, 'users')
  await expect(suggestWidget).toContainText('users')
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

  const suggestWidget = await openAutocomplete(page, 'email')

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

  const suggestWidget = await openAutocomplete(page, 'event_name')

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

  const suggestWidget = await openAutocomplete(page, 'email')
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

test('FROM without a selected database suggests databases but not random tables', async ({
  page,
}) => {
  test.setTimeout(APP_READY_MS)

  const parserErrors = trackSqlParserConsoleErrors(page)

  await waitForApp(page)
  await openQueryEditorTab(page)

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })

  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT * FROM ')

  const suggestWidget = await openAutocomplete(page, 'ecommerce_db')
  await expect(suggestWidget).toContainText('ecommerce_db')
  await expect(suggestWidget).toContainText('analytics_db')
  await expect(suggestWidget).not.toContainText('users')
  await expect(suggestWidget).not.toContainText('orders')
  await expect(suggestWidget).not.toContainText('events')
  await page.waitForTimeout(SUGGESTION_SETTLE_MS)

  expect(parserErrors).toEqual([])
})

test('FROM ranks databases above keywords when no database is selected', async ({ page }) => {
  test.setTimeout(APP_READY_MS)

  await waitForApp(page)
  await openQueryEditorTab(page)

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })

  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT * FROM ')

  const suggestWidget = await openAutocomplete(page, 'ecommerce_db')
  await page.waitForTimeout(SUGGESTION_SETTLE_MS)

  const optionLabels = await suggestWidget
    .locator('.monaco-list-row')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label') ?? r.textContent ?? ''))

  const databaseNames = ['ecommerce_db', 'analytics_db', 'staging_db']
  const keywordNames = ['SELECT', 'FROM', 'WHERE', 'ORDER', 'GROUP', 'LIMIT']

  const firstDatabaseIndex = optionLabels.findIndex((label) =>
    databaseNames.some((db) => label.toLowerCase().includes(db.toLowerCase()))
  )
  const firstKeywordIndex = optionLabels.findIndex((label) =>
    keywordNames.some((kw) => label.toLowerCase().includes(kw.toLowerCase()))
  )

  expect(firstDatabaseIndex).toBeGreaterThanOrEqual(0)
  expect(firstKeywordIndex).toBeGreaterThanOrEqual(0)
  expect(firstDatabaseIndex).toBeLessThan(firstKeywordIndex)
})

test('FROM with a database selected scopes table suggestions to that database', async ({
  page,
}) => {
  test.setTimeout(APP_READY_MS)

  await waitForApp(page)
  await connectToSample(page)
  await selectDatabaseInObjectBrowser(page, 'ecommerce_db')
  await page.getByTestId('new-query-tab-button').click()
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })

  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT * FROM ')

  const suggestWidget = await openAutocomplete(page, 'users')
  await expect(suggestWidget).toContainText('users')
  await expect(suggestWidget).toContainText('orders')
  await expect(suggestWidget).toContainText('products')
  await expect(suggestWidget).not.toContainText('events')
})

test('selecting a database in object browser changes the session database used for queries', async ({
  page,
}) => {
  test.setTimeout(APP_READY_MS)

  await waitForApp(page)
  await connectToSample(page)
  await selectDatabaseInObjectBrowser(page, 'analytics_db')
  await page.getByTestId('new-query-tab-button').click()
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })

  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT DATABASE();')
  await page.getByTestId('toolbar-execute').click()

  await expect(page.getByTestId('result-grid-view')).toContainText('analytics_db', {
    timeout: APP_READY_MS,
  })
})

test('FROM with a selected database suggests databases and scoped tables before keywords', async ({
  page,
}) => {
  test.setTimeout(APP_READY_MS)

  await waitForApp(page)
  await connectToSample(page)
  await selectDatabaseInObjectBrowser(page, 'analytics_db')
  await page.getByTestId('new-query-tab-button').click()
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })

  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT * FROM ')

  const suggestWidget = await openAutocomplete(page, 'events')
  await expect(suggestWidget).toContainText('analytics_db')
  await expect(suggestWidget).toContainText('events')
  await page.waitForTimeout(SUGGESTION_SETTLE_MS)

  const optionLabels = await suggestWidget
    .locator('.monaco-list-row')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label') ?? r.textContent ?? ''))

  const firstSchemaIndex = optionLabels.findIndex((label) =>
    ['analytics_db', 'events'].some((name) => label.toLowerCase().includes(name.toLowerCase()))
  )
  const firstKeywordIndex = optionLabels.findIndex((label) =>
    ['lateral', 'select', 'from', 'where', 'order', 'group', 'limit'].some((kw) =>
      label.toLowerCase().includes(kw)
    )
  )

  expect(firstSchemaIndex).toBeGreaterThanOrEqual(0)
  if (firstKeywordIndex >= 0) {
    expect(firstSchemaIndex).toBeLessThan(firstKeywordIndex)
  }
})

test('FROM ignores connection default database when no object-browser database is selected', async ({
  page,
}) => {
  test.setTimeout(APP_READY_MS)

  await waitForApp(page)
  await openQueryEditorTab(page)

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })

  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT * FROM ')

  const suggestWidget = await openAutocomplete(page, 'ecommerce_db')
  await expect(suggestWidget).toContainText('ecommerce_db')
  await expect(suggestWidget).toContainText('analytics_db')
  await expect(suggestWidget).toContainText('staging_db')
  await expect(suggestWidget).not.toContainText('users')
  await expect(suggestWidget).not.toContainText('orders')
  await expect(suggestWidget).not.toContainText('products')
  await expect(suggestWidget).not.toContainText('events')
})

test('invalid FROM table-dot syntax does not suggest columns', async ({ page }) => {
  test.setTimeout(APP_READY_MS)

  await waitForApp(page)
  await openQueryEditorTab(page)

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })

  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('SELECT * FROM users.')

  const suggestWidget = await openAutocomplete(page)
  await expect(suggestWidget).not.toContainText('email')
  await expect(suggestWidget).not.toContainText('created_at')
})

test('autocomplete does not show lowercase SQL snippets', async ({ page }) => {
  test.setTimeout(APP_READY_MS)

  await waitForApp(page)
  await openQueryEditorTab(page)

  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout: APP_READY_MS })

  await editorSurface.click({ position: { x: 160, y: 40 } })
  await page.keyboard.type('selec')

  const suggestWidget = await openAutocomplete(page, 'SELECT')
  await expect(suggestWidget).toContainText('SELECT')
  await expect(suggestWidget).not.toContainText('select-join')
  await expect(suggestWidget).not.toContainText('select-order-by')
  await expect(suggestWidget).not.toContainText('insert-into-select')
  await expect(suggestWidget).not.toContainText('create-table-as-select')
})
