import { test, expect, type Page } from '@playwright/test'
import { APP_READY_MS, connectToSample, waitForApp, waitForAutocomplete } from './helpers'

const SUGGESTION_SETTLE_MS = 500
const EDITOR_CLICK_POSITION = { x: 160, y: 40 } as const

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

async function openQueryEditorTab(page: Page) {
  await connectToSample(page)
  await page.getByTestId('new-query-tab-button').click()
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: APP_READY_MS })
}

async function focusMonacoEditor(page: Page, timeout = APP_READY_MS) {
  const editorSurface = page.locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout })
  await editorSurface.click({ position: EDITOR_CLICK_POSITION })
  return editorSurface
}

async function waitForQueryContent(page: Page, expectedContent: string) {
  await expect
    .poll(
      async () =>
        page.evaluate((expected) => {
          const queryStore = (
            window as unknown as {
              __queryStore__?: {
                getState?: () => {
                  tabs?: Record<string, { content?: string }>
                }
              }
            }
          ).__queryStore__

          return Object.values(queryStore?.getState?.().tabs ?? {}).some(
            (tab) => tab?.content === expected
          )
        }, expectedContent),
      { timeout: 5_000, intervals: [100, 200, 300] }
    )
    .toBe(true)
}

async function waitForActiveResultValue(page: Page, expectedValue: unknown) {
  await expect
    .poll(
      async () =>
        page.evaluate((expected) => {
          const queryStore = (
            window as unknown as {
              __queryStore__?: {
                getState?: () => {
                  tabs?: Record<
                    string,
                    {
                      activeResultIndex?: number
                      results?: Array<{ rows?: unknown[][]; resultStatus?: string }>
                    }
                  >
                }
              }
            }
          ).__queryStore__

          return Object.values(queryStore?.getState?.().tabs ?? {}).some((tab) => {
            const resultIndex = tab?.activeResultIndex ?? 0
            const activeResult = tab?.results?.[resultIndex]
            const value = activeResult?.rows?.[0]?.[0]
            return activeResult?.resultStatus === 'success' && value === expected
          })
        }, expectedValue),
      { timeout: 5_000, intervals: [100, 200, 300] }
    )
    .toBe(true)
}

async function typeQuery(page: Page, sql: string) {
  await focusMonacoEditor(page)
  await page.keyboard.type(sql)
  await waitForQueryContent(page, sql)
}

async function openAutocomplete(
  page: Page,
  expectedText?: string,
  options: { allowNoWidget?: boolean } = {}
) {
  return waitForAutocomplete(page, expectedText, options)
}

async function selectDatabaseInObjectBrowser(page: Page, databaseName: string) {
  await page.getByText(databaseName).first().click()
}

async function injectMalformedSchemaMetadata(page: Page) {
  await page.evaluate((schemaMetadata) => {
    ;(
      window as unknown as { __PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__: unknown }
    ).__PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__ = schemaMetadata
  }, MALFORMED_SCHEMA_METADATA)
}

async function clearSchemaMetadataOverride(page: Page) {
  if (page.isClosed()) {
    return
  }

  try {
    await page.evaluate(() => {
      delete (window as unknown as { __PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__?: unknown })
        .__PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__
    })
  } catch {
    // Context may have been destroyed by test timeout or navigation — non-fatal cleanup.
  }
}

function expectAutocomplete(
  suggestWidget: ReturnType<Page['locator']> | null
): asserts suggestWidget is ReturnType<Page['locator']> {
  expect(suggestWidget).not.toBeNull()
}

test.describe('Monaco SQL autocomplete', () => {
  // The first test in this serial project absorbs the cold-start cost: Vite module
  // transforms, V8 compilation of React/Monaco/data grid code, AND the autocomplete code paths
  // (completion provider, suggestion widget rendering).  Each subsequent test gets a fresh
  // page but reuses V8's compiled bytecode from the same browser instance.
  test('warm-up: full autocomplete flow to prime all browser caches', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)
    await typeQuery(page, 'SELECT ')
    // Trigger autocomplete to compile suggestion-related Monaco modules.
    // We don't care whether it succeeds — just warming the code path.
    await page.keyboard.press('Control+Space')
    await page
      .locator('.suggest-widget.visible')
      .waitFor({ state: 'visible', timeout: APP_READY_MS })
      .catch(() => {})
  })

  // The alias-completion test runs first intentionally: the malformed-schema-metadata
  // test is more expensive (extra metadata injection + console listener + cleanup) and
  // benefits from a warm Vite/Chromium that a simpler test establishes.
  test('alias completion: FROM users t → t. suggests users columns', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)

    await typeQuery(page, 'SELECT * FROM users t WHERE t.')

    const suggestWidget = await openAutocomplete(page, 'email')
    expectAutocomplete(suggestWidget)

    // Verify the suggestions include column names from the users table
    await expect(suggestWidget).toContainText('id')
    await expect(suggestWidget).toContainText('email')
    await expect(suggestWidget).toContainText('name')
    await page.waitForTimeout(SUGGESTION_SETTLE_MS)
  })

  test('alias completion: FROM analytics_db.events e → e. suggests events columns', async ({
    page,
  }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)

    await typeQuery(page, 'SELECT * FROM analytics_db.events e WHERE e.')

    const suggestWidget = await openAutocomplete(page, 'event_name')
    expectAutocomplete(suggestWidget)

    // Verify the suggestions include column names from analytics_db.events
    await expect(suggestWidget).toContainText('event_name')
    await expect(suggestWidget).toContainText('user_id')
    await expect(suggestWidget).toContainText('created_at')
    await page.waitForTimeout(SUGGESTION_SETTLE_MS)
  })

  test('context-aware ranking: WHERE clause → columns ranked above keywords', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)

    // Type a WHERE query — the space after WHERE triggers column context
    await typeQuery(page, 'SELECT * FROM users WHERE ')

    const suggestWidget = await openAutocomplete(page, 'email')
    expectAutocomplete(suggestWidget)
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
    const parserErrors = trackSqlParserConsoleErrors(page)

    await waitForApp(page)
    await openQueryEditorTab(page)

    await typeQuery(page, 'SELECT * FROM ')

    const suggestWidget = await openAutocomplete(page, 'ecommerce_db')
    expectAutocomplete(suggestWidget)
    await expect(suggestWidget).toContainText('ecommerce_db')
    await expect(suggestWidget).toContainText('analytics_db')
    await expect(suggestWidget).not.toContainText('users')
    await expect(suggestWidget).not.toContainText('orders')
    await expect(suggestWidget).not.toContainText('events')
    await page.waitForTimeout(SUGGESTION_SETTLE_MS)

    expect(parserErrors).toEqual([])
  })

  test('FROM ranks databases above keywords when no database is selected', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)

    await typeQuery(page, 'SELECT * FROM ')

    const suggestWidget = await openAutocomplete(page, 'ecommerce_db')
    expectAutocomplete(suggestWidget)
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
    await waitForApp(page)
    await connectToSample(page)
    await selectDatabaseInObjectBrowser(page, 'ecommerce_db')
    await page.getByTestId('new-query-tab-button').click()
    await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

    await typeQuery(page, 'SELECT * FROM ')

    const suggestWidget = await openAutocomplete(page, 'users')
    expectAutocomplete(suggestWidget)
    await expect(suggestWidget).toContainText('users')
    await expect(suggestWidget).toContainText('orders')
    await expect(suggestWidget).toContainText('products')
    await expect(suggestWidget).not.toContainText('events')
  })

  test('selecting a database in object browser changes the session database used for queries', async ({
    page,
  }) => {
    await waitForApp(page)
    await connectToSample(page)
    await selectDatabaseInObjectBrowser(page, 'analytics_db')
    await page.getByTestId('new-query-tab-button').click()
    await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

    await typeQuery(page, 'SELECT DATABASE();')
    await page.keyboard.press('F9')

    await expect(page.getByTestId('result-grid')).toBeVisible({ timeout: APP_READY_MS })
    await waitForActiveResultValue(page, 'analytics_db')
  })

  test('FROM with a selected database suggests databases and scoped tables before keywords', async ({
    page,
  }) => {
    await waitForApp(page)
    await connectToSample(page)
    await selectDatabaseInObjectBrowser(page, 'analytics_db')
    await page.getByTestId('new-query-tab-button').click()
    await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

    await typeQuery(page, 'SELECT * FROM ')

    const suggestWidget = await openAutocomplete(page, 'events')
    expectAutocomplete(suggestWidget)
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
    await waitForApp(page)
    await openQueryEditorTab(page)

    await typeQuery(page, 'SELECT * FROM ')

    const suggestWidget = await openAutocomplete(page, 'ecommerce_db')
    expectAutocomplete(suggestWidget)
    await expect(suggestWidget).toContainText('ecommerce_db')
    await expect(suggestWidget).toContainText('analytics_db')
    await expect(suggestWidget).toContainText('staging_db')
    await expect(suggestWidget).not.toContainText('users')
    await expect(suggestWidget).not.toContainText('orders')
    await expect(suggestWidget).not.toContainText('products')
    await expect(suggestWidget).not.toContainText('events')
  })

  test('invalid FROM table-dot syntax does not suggest columns', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)

    await typeQuery(page, 'SELECT * FROM users.')

    const suggestWidget = await openAutocomplete(page, undefined, { allowNoWidget: true })
    if (suggestWidget) {
      await expect(suggestWidget).not.toContainText('email')
      await expect(suggestWidget).not.toContainText('created_at')
    }
  })

  test('autocomplete does not show lowercase SQL snippets', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)

    await typeQuery(page, 'selec')

    const suggestWidget = await openAutocomplete(page, 'SELECT')
    expectAutocomplete(suggestWidget)
    await expect(suggestWidget).toContainText('SELECT')
    await expect(suggestWidget).not.toContainText('select-join')
    await expect(suggestWidget).not.toContainText('select-order-by')
    await expect(suggestWidget).not.toContainText('insert-into-select')
    await expect(suggestWidget).not.toContainText('create-table-as-select')
  })

  test('autocomplete suggests built-in SQL functions in expression context', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)

    await typeQuery(page, 'SELECT SL')

    const suggestWidget = await openAutocomplete(page, 'SLEEP')
    expectAutocomplete(suggestWidget)
    await expect(suggestWidget).toContainText('SLEEP')
  })

  test('CALL suggests database names and scoped procedures', async ({ page }) => {
    await waitForApp(page)
    await openQueryEditorTab(page)

    await typeQuery(page, 'CALL ')

    const suggestWidget = await openAutocomplete(page, 'sp_get_orders')
    expectAutocomplete(suggestWidget)
    await expect(suggestWidget).toContainText('ecommerce_db')
    await expect(suggestWidget).toContainText('analytics_db')
    await expect(suggestWidget).toContainText('staging_db')
    await expect(suggestWidget).toContainText('sp_get_orders')
    await expect(suggestWidget).not.toContainText('fn_calculate_total')
  })

  // This test runs last: it injects malformed metadata + attaches a console listener,
  // making it the most expensive autocomplete test.  Running it after the simpler tests
  // ensures Vite and Chromium are warm, so the 25s project timeout is not eaten by cold-start.
  test('autocomplete ignores malformed schema metadata instead of emitting invalid Monaco items', async ({
    page,
  }) => {
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

    try {
      await waitForApp(page)

      await injectMalformedSchemaMetadata(page)

      await openQueryEditorTab(page)

      await typeQuery(page, 'SELECT * FROM valid_db.')

      const suggestWidget = await openAutocomplete(page, 'users')
      expectAutocomplete(suggestWidget)
      await expect(suggestWidget).toContainText('users')
      await page.waitForTimeout(SUGGESTION_SETTLE_MS)

      expect(invalidCompletionWarnings).toEqual([])
    } finally {
      await clearSchemaMetadataOverride(page)
    }
  })
})
