import { test, expect, type Page } from '@playwright/test'

const themes = ['light', 'dark'] as const

/** Dev server + async `main.tsx` (dynamic imports, IPC mock, theme) under many parallel workers can exceed the default 5s expect timeout. */
const APP_READY_MS = 60_000

/** Many parallel workers can briefly see net::ERR_CONNECTION_FAILED if the first goto races the Vite server. */
const GOTO_RETRY_ATTEMPTS = 5
const GOTO_RETRY_DELAY_MS = 800

async function waitForApp(page: Page) {
  for (let attempt = 0; attempt < GOTO_RETRY_ATTEMPTS; attempt++) {
    try {
      await page.goto('/', { waitUntil: 'load', timeout: APP_READY_MS })
      break
    } catch (err) {
      if (attempt === GOTO_RETRY_ATTEMPTS - 1) {
        throw err
      }
      await new Promise((r) => setTimeout(r, GOTO_RETRY_DELAY_MS))
    }
  }
  await expect(page.getByTestId('app-layout')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('status-bar')).toContainText('Ready', { timeout: APP_READY_MS })
  await page.evaluate(() => document.fonts.ready)
}

async function ensureTheme(page: Page, theme: 'light' | 'dark') {
  for (let i = 0; i < 6; i++) {
    const cur = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    if (cur === theme) {
      return
    }
    await page.getByTestId('theme-toggle').click()
  }
  throw new Error(`Could not apply theme "${theme}"`)
}

async function dismissAllToasts(page: Page) {
  for (let i = 0; i < 8; i++) {
    const btn = page.getByTestId('toast-dismiss').first()
    if (!(await btn.isVisible().catch(() => false))) {
      break
    }
    await btn.click()
  }
}

async function openConnectionManager(page: Page) {
  await page.getByRole('button', { name: 'New Connection' }).first().click()
  await expect(page.getByTestId('connection-dialog')).toBeVisible()
  await expect(page.getByText('Sample MySQL')).toBeVisible()
}

/** Stacked toasts aligned with `.agent/design/toast_notifications_*` copy — for visual regression only. */
async function showDesignReferenceToasts(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__toastStore__ as {
      getState: () => {
        showInfo: (t: string, m?: string) => void
        showError: (t: string, m?: string) => void
        showSuccess: (t: string, m?: string) => void
      }
    }
    const { showInfo, showError, showSuccess } = store.getState()
    showInfo('Update Available', 'SQL Architect v2.5.1 is ready for installation.')
    showError('Authentication Error', 'Invalid credentials for user: admin@localhost')
    showSuccess('Query Executed', 'Successfully retrieved 450 rows in 12ms.')
  })
}

async function connectToSample(page: Page) {
  await openConnectionManager(page)
  await page.getByText('Sample MySQL').click()
  await page
    .getByTestId('connection-dialog')
    .getByRole('button', { name: 'Connect', exact: true })
    .click()
  await expect(page.getByTestId('connection-dialog')).toBeHidden()
  // Wait for the object browser to load databases
  await expect(page.getByTestId('object-browser')).toBeVisible()
  await expect(page.getByText('ecommerce_db')).toBeVisible()
  /* Dismiss success toasts so visual baselines stay stable */
  await dismissAllToasts(page)
}

/**
 * Second session injected for tab-bar visuals only (keeps `list_connections` single-item so other screenshots stay stable).
 * Sample MySQL (#2563eb) active → horizontal underline in profile color; Staging (#d97706) inactive → vertical accent.
 */
async function openTwoConnectionSessionsFirstActive(page: Page) {
  await connectToSample(page)
  await page.evaluate(() => {
    const useConnectionStore = (window as unknown as Record<string, unknown>)
      .__connectionStore__ as {
      setState: (
        fn: (state: {
          activeConnections: Record<
            string,
            { id: string; profile: Record<string, unknown>; status: string; serverVersion: string }
          >
        }) => Record<string, unknown>
      ) => void
    }
    const stagingProfile = {
      id: 'conn-playwright-2',
      name: 'Staging MySQL',
      host: '10.0.0.5',
      port: 3307,
      username: 'staging',
      hasPassword: true,
      defaultDatabase: null,
      sslEnabled: false,
      sslCaPath: null,
      sslCertPath: null,
      sslKeyPath: null,
      color: '#d97706',
      groupId: null,
      readOnly: false,
      sortOrder: 1,
      connectTimeoutSecs: 10,
      keepaliveIntervalSecs: 60,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }
    useConnectionStore.setState((state) => ({
      activeConnections: {
        ...state.activeConnections,
        'session-playwright-2': {
          id: 'session-playwright-2',
          profile: stagingProfile,
          status: 'connected',
          serverVersion: '8.0.33-mock',
        },
      },
      activeTabId: 'session-playwright-1',
    }))
  })
  await expect(page.getByText('Staging MySQL')).toBeVisible()
  await expect(page.getByTestId('connection-session-tab-session-playwright-1')).toHaveAttribute(
    'data-active',
    'true'
  )
}

/** Connected workspace with schema-info active and a second tab so the top strip is visible in screenshots. */
async function openSchemaInfoWithWorkspaceTabStrip(page: Page) {
  await connectToSample(page)
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { openTab: (tab: Record<string, unknown>) => void }
    }
    const open = store.getState().openTab
    open({
      type: 'table-data',
      label: 'ecommerce_db.orders',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'orders',
      objectType: 'table',
    })
    open({
      type: 'schema-info',
      label: 'users',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'users',
      objectType: 'table',
    })
  })
  await expect(page.getByTestId('workspace-tabs')).toBeVisible()
  await expect(page.getByTestId('schema-info-tab')).toBeVisible()
  await expect(page.getByTestId('stats-row')).toBeVisible()
}

/** Open a query editor tab via the "+" button after connecting. */
async function openQueryEditorTab(page: Page) {
  await connectToSample(page)
  await page.getByTestId('new-query-tab-button').click()
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
  // Wait for the editor toolbar to settle
  await expect(page.getByTestId('editor-toolbar')).toBeVisible()
}

async function waitForAutocomplete(page: Page, expectedText?: string) {
  const suggestWidget = page.locator('.suggest-widget.visible')

  for (let attempt = 0; attempt < 8; attempt++) {
    await page.keyboard.press('Control+Space')
    await expect(suggestWidget).toBeVisible({ timeout: APP_READY_MS })

    const text = (await suggestWidget.textContent()) ?? ''
    if (!text.includes('Loading...') && (!expectedText || text.includes(expectedText))) {
      return suggestWidget
    }

    await page.waitForTimeout(300)
  }

  return suggestWidget
}

/** Open a query editor tab, set SQL content, execute, and wait for results. */
async function openQueryEditorWithResults(page: Page) {
  await openQueryEditorTab(page)

  // Set content in the query store so the Execute button becomes enabled
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__queryStore__ as {
      getState: () => { tabs: Record<string, { content: string }> }
      setState: (fn: (state: Record<string, unknown>) => Record<string, unknown>) => void
    }
    // Find the active query tab (first one)
    const tabIds = Object.keys(store.getState().tabs)
    if (tabIds.length === 0) {
      // No tab state yet — we need to find the tab ID from workspace store
      const wsStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
        getState: () => {
          activeTabByConnection: Record<string, string | null>
          tabsByConnection: Record<string, { id: string; type: string }[]>
        }
      }
      const activeTabs = wsStore.getState().tabsByConnection['session-playwright-1'] ?? []
      const queryTab = activeTabs.find((t) => t.type === 'query-editor')
      if (queryTab) {
        const qStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
          getState: () => { setContent: (id: string, c: string) => void }
        }
        qStore.getState().setContent(queryTab.id, 'SELECT * FROM users;')
      }
    } else {
      const qStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
        getState: () => { setContent: (id: string, c: string) => void }
      }
      qStore.getState().setContent(tabIds[0], 'SELECT * FROM users;')
    }
  })

  // Wait a tick for React to re-render with the content
  await page.waitForTimeout(300)

  // Click the Execute Query button
  await page.getByTestId('toolbar-execute').click()

  // Wait for results to appear
  await expect(page.getByTestId('result-toolbar')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('result-grid-view')).toBeVisible({ timeout: APP_READY_MS })
}

/** Open a table data tab for the `users` table and wait for data to load. */
async function openTableDataTab(page: Page) {
  await connectToSample(page)

  // Programmatically open a table-data tab via the workspace store
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { openTab: (tab: Record<string, unknown>) => void }
    }
    store.getState().openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'users',
      objectType: 'table',
    })
  })

  // Wait for the table data tab to mount and data to load
  await expect(page.getByTestId('table-data-tab')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('table-data-toolbar')).toBeVisible({ timeout: APP_READY_MS })
  // Wait for loading to finish — the toolbar shows row count when done
  await expect(page.getByTestId('table-data-toolbar')).toContainText('Rows', {
    timeout: APP_READY_MS,
  })
}

/** Stable scroll for full-layout screenshots (parallel workers otherwise differ on tree scroll). */
async function resetChromeScrollPositions(page: Page) {
  await page.getByTestId('object-browser-scroll').evaluate((el) => {
    el.scrollTop = 0
  })
  await page.evaluate(() => {
    window.scrollTo(0, 0)
  })
}

for (const theme of themes) {
  test.describe(`visual regression (${theme})`, () => {
    test.beforeEach(async ({ page }) => {
      await waitForApp(page)
      await ensureTheme(page, theme)
    })

    test('welcome — full page', async ({ page }) => {
      await expect(page).toHaveScreenshot(`welcome-full-${theme}.png`, { fullPage: true })
    })

    test('AppLayout — app-layout', async ({ page }) => {
      await expect(page.getByTestId('app-layout')).toHaveScreenshot(`app-layout-${theme}.png`)
    })

    test('ConnectionTabBar — connection-tab-bar', async ({ page }) => {
      await expect(page.getByTestId('connection-tab-bar')).toHaveScreenshot(
        `connection-tab-bar-${theme}.png`
      )
    })

    test('Sidebar — sidebar-inner', async ({ page }) => {
      await expect(page.getByTestId('sidebar-inner')).toHaveScreenshot(`sidebar-inner-${theme}.png`)
    })

    test('WorkspaceArea — welcome', async ({ page }) => {
      await expect(page.getByTestId('workspace-area')).toHaveScreenshot(
        `workspace-area-welcome-${theme}.png`
      )
    })

    test('StatusBar — ready', async ({ page }) => {
      await expect(page.getByTestId('status-bar')).toHaveScreenshot(`status-bar-ready-${theme}.png`)
    })

    test('ToastViewport — stacked toasts (design reference)', async ({ page }) => {
      await showDesignReferenceToasts(page)
      await expect(page.getByTestId('toast-stack')).toBeVisible()
      await expect(page.getByTestId('toast-stack')).toHaveScreenshot(`toast-stack-${theme}.png`, {
        animations: 'disabled',
      })
    })

    test('ConnectionDialog — full dialog', async ({ page }) => {
      await openConnectionManager(page)
      await expect(page.getByTestId('connection-dialog')).toHaveScreenshot(
        `connection-dialog-${theme}.png`
      )
    })

    test('SavedConnectionsList — saved-connections-pane', async ({ page }) => {
      await openConnectionManager(page)
      await expect(page.getByTestId('saved-connections-pane')).toHaveScreenshot(
        `saved-connections-pane-${theme}.png`
      )
    })

    test('ConnectionForm — main pane', async ({ page }) => {
      await openConnectionManager(page)
      await page.evaluate(() => {
        const el = document.activeElement
        if (el && el instanceof HTMLElement) {
          el.blur()
        }
      })
      await expect(page.getByTestId('connection-form-main')).toHaveScreenshot(
        `connection-form-main-${theme}.png`,
        { animations: 'disabled', timeout: 30_000 }
      )
    })

    test('TestConnectionResult — after successful test', async ({ page }) => {
      await openConnectionManager(page)
      await page.getByText('Sample MySQL').click()
      await page
        .getByTestId('connection-dialog')
        .getByRole('button', { name: 'Test Connection' })
        .click()
      await expect(page.getByTestId('test-connection-result')).toBeVisible()
      await expect(page.getByTestId('test-connection-result')).toHaveScreenshot(
        `test-connection-result-${theme}.png`
      )
    })

    test('ColorPickerPopover — open', async ({ page }) => {
      await openConnectionManager(page)
      await page.getByRole('button', { name: 'Choose color' }).click()
      await expect(page.getByTestId('color-picker-popover')).toBeVisible()
      await expect(page.getByTestId('color-picker-popover')).toHaveScreenshot(
        `color-picker-popover-${theme}.png`
      )
    })

    test('Dropdown — group list open', async ({ page }) => {
      await openConnectionManager(page)
      const dropdownRoot = page.getByTestId('connection-form-main').locator('.ui-dropdown')
      await dropdownRoot.locator('#conn-group').click()
      await expect(dropdownRoot.getByRole('listbox')).toBeVisible()
      await expect(dropdownRoot).toHaveScreenshot(`group-dropdown-open-${theme}.png`)
    })

    test('GlobalContextMenu — on host field', async ({ page }) => {
      await openConnectionManager(page)
      await page.locator('#conn-host').click({ button: 'right' })
      await expect(page.getByTestId('global-context-menu')).toBeVisible()
      await expect(page.getByTestId('global-context-menu')).toHaveScreenshot(
        `global-context-menu-${theme}.png`
      )
    })

    test('CollapsibleSection — SSL certificate files expanded', async ({ page }) => {
      await openConnectionManager(page)
      await page
        .getByTestId('ssl-certificate-section')
        .getByRole('button', { name: /SSL certificate files/i })
        .click()
      await expect(page.getByTestId('ssl-certificate-section')).toHaveScreenshot(
        `ssl-certificate-section-expanded-${theme}.png`
      )
    })

    test('connected — workspace, tab bar, status bar', async ({ page }) => {
      await connectToSample(page)
      await expect(page.getByTestId('workspace-area')).toContainText('Connected to')
      await expect(page.getByTestId('workspace-area')).toHaveScreenshot(
        `workspace-area-connected-${theme}.png`
      )
      await expect(page.getByTestId('connection-tab-bar')).toHaveScreenshot(
        `connection-tab-bar-connected-${theme}.png`
      )
      await expect(page.getByTestId('status-bar')).toHaveScreenshot(
        `status-bar-connected-${theme}.png`
      )
    })

    test('ConnectionTabBar — two sessions (inactive vertical accent, active color underline)', async ({
      page,
    }) => {
      await openTwoConnectionSessionsFirstActive(page)
      await expect(page.getByTestId('connection-tab-bar')).toHaveScreenshot(
        `connection-tab-bar-two-sessions-color-accents-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('ObjectBrowser — connected sidebar with databases', async ({ page }) => {
      await connectToSample(page)
      await expect(page.getByTestId('object-browser')).toHaveScreenshot(
        `object-browser-connected-${theme}.png`
      )
    })

    test('ConnectionHeader — connected header', async ({ page }) => {
      await connectToSample(page)
      await expect(page.getByTestId('connection-header')).toHaveScreenshot(
        `connection-header-${theme}.png`
      )
    })

    test('SchemaInfoTab — DDL view', async ({ page }) => {
      await connectToSample(page)

      // Open a schema-info tab programmatically via the exposed workspace store
      await page.evaluate(() => {
        const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
          getState: () => {
            openTab: (tab: Record<string, unknown>) => void
          }
        }
        store.getState().openTab({
          type: 'schema-info',
          label: 'users',
          connectionId: 'session-playwright-1',
          databaseName: 'ecommerce_db',
          objectName: 'users',
          objectType: 'table',
        })
      })

      // Wait for the schema info tab to load data
      await expect(page.getByTestId('schema-info-tab')).toBeVisible()
      await expect(page.getByTestId('stats-row')).toBeVisible()

      // Switch to DDL sub-tab
      await page.getByRole('button', { name: 'DDL' }).click()
      await expect(page.getByTestId('ddl-panel')).toBeVisible()

      await expect(page.getByTestId('schema-info-tab')).toHaveScreenshot(
        `schema-info-ddl-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('WorkspaceTabs — strip above schema-info (multi-tab)', async ({ page }) => {
      await openSchemaInfoWithWorkspaceTabStrip(page)
      await expect(page.getByTestId('workspace-tabs')).toHaveScreenshot(
        `workspace-tabs-above-schema-info-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('WorkspaceArea — tabs + schema-info header region', async ({ page }) => {
      await openSchemaInfoWithWorkspaceTabStrip(page)
      await expect(page.getByTestId('workspace-area')).toHaveScreenshot(
        `workspace-area-schema-info-with-tabs-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('full app layout — schema-info selected (columns, multi-tab)', async ({ page }) => {
      await openSchemaInfoWithWorkspaceTabStrip(page)
      await expect(page.getByTestId('columns-panel')).toBeVisible()
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('app-layout')).toHaveScreenshot(
        `app-full-layout-schema-info-columns-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('full app layout — schema-info DDL sub-tab (multi-tab)', async ({ page }) => {
      await openSchemaInfoWithWorkspaceTabStrip(page)
      await page.getByRole('button', { name: 'DDL' }).click()
      await expect(page.getByTestId('ddl-panel')).toBeVisible()
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('app-layout')).toHaveScreenshot(
        `app-full-layout-schema-info-ddl-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('ObjectBrowserContextMenu — database node', async ({ page }) => {
      await connectToSample(page)

      // Right-click on a database node to show context menu
      const dbNode = page.getByText('ecommerce_db').first()
      await dbNode.click({ button: 'right' })
      await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

      await expect(page.getByTestId('object-browser-context-menu')).toHaveScreenshot(
        `context-menu-database-${theme}.png`
      )
    })

    test('ObjectBrowserContextMenu — table node', async ({ page }) => {
      await connectToSample(page)

      // Expand database and Tables category to reach table nodes
      await page.getByText('ecommerce_db').first().click()
      await expect(page.getByText('Tables')).toBeVisible()
      await page.getByText('Tables').click()
      await expect(page.getByText('users')).toBeVisible()

      // Right-click on a table node
      await page.getByText('users').click({ button: 'right' })
      await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

      await expect(page.getByTestId('object-browser-context-menu')).toHaveScreenshot(
        `context-menu-table-${theme}.png`
      )
    })

    test('ConfirmDialog — drop database confirmation', async ({ page }) => {
      await connectToSample(page)

      // Right-click on a database node to show context menu
      const dbNode = page.getByText('ecommerce_db').first()
      await dbNode.click({ button: 'right' })
      await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

      // Click "Drop Database..."
      await page.getByTestId('ctx-drop-database').click()
      await expect(page.getByTestId('confirm-dialog')).toBeVisible()

      await expect(page.getByTestId('confirm-dialog')).toHaveScreenshot(
        `confirm-dialog-drop-database-${theme}.png`
      )
    })

    test('CreateDatabaseDialog — open', async ({ page }) => {
      await connectToSample(page)

      // Right-click on a database node to show context menu
      const dbNode = page.getByText('ecommerce_db').first()
      await dbNode.click({ button: 'right' })
      await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

      // Click "Create Database..."
      await page.getByTestId('ctx-create-database').click()
      await expect(page.getByTestId('create-database-dialog')).toBeVisible()
      // Charset/collation IPC resolves async; wait so the screenshot matches a stable loaded state
      await expect(page.getByTestId('create-db-form')).not.toHaveAttribute('aria-busy')

      // Full viewport: modal + dimmed app behind it. Reset object-browser scroll so the blurred/dimmed
      // tree is identical across parallel workers (otherwise scrollTop races dominate pixel diffs).
      await page.getByTestId('object-browser-scroll').evaluate((el) => {
        el.scrollTop = 0
      })
      await page.evaluate(() => {
        window.scrollTo(0, 0)
      })

      await expect(page).toHaveScreenshot(`create-database-dialog-${theme}.png`, {
        animations: 'disabled',
      })
    })

    // --- Query Editor states ---

    test('QueryEditorTab — empty (no query run)', async ({ page }) => {
      await openQueryEditorTab(page)
      // Screenshot the toolbar + result panel (idle placeholder)
      await expect(page.getByTestId('editor-toolbar')).toHaveScreenshot(
        `query-editor-toolbar-empty-${theme}.png`,
        { animations: 'disabled' }
      )
      await expect(page.getByTestId('result-panel')).toHaveScreenshot(
        `query-editor-result-panel-empty-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('QueryEditorTab — SQL autocomplete suggest widget', async ({ page }) => {
      await openQueryEditorTab(page)
      const surface = page.getByTestId('monaco-editor-wrapper').locator('.monaco-editor').first()
      await surface.click()
      await page.keyboard.type('SELECT * FROM e')
      await waitForAutocomplete(page, 'ecommerce_db')
      await expect(page.getByTestId('monaco-editor-wrapper')).toHaveScreenshot(
        `query-editor-sql-autocomplete-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('QueryEditorTab — with results (success)', async ({ page }) => {
      await openQueryEditorWithResults(page)
      // Screenshot the result toolbar and grid
      await expect(page.getByTestId('result-toolbar')).toHaveScreenshot(
        `query-editor-result-toolbar-success-${theme}.png`,
        { animations: 'disabled' }
      )
      await expect(page.getByTestId('result-grid-view')).toHaveScreenshot(
        `query-editor-result-grid-success-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('QueryEditorTab — with results sorted by name', async ({ page }) => {
      await openQueryEditorWithResults(page)

      await page.evaluate(() => {
        const wsStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
          getState: () => {
            activeTabByConnection: Record<string, string | null>
          }
        }
        const queryStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
          setState: (
            updater: (state: { tabs: Record<string, Record<string, unknown>> }) => {
              tabs: Record<string, Record<string, unknown>>
            }
          ) => void
        }

        const activeTabId = wsStore.getState().activeTabByConnection['session-playwright-1']
        if (!activeTabId) {
          throw new Error('No active query tab found for sorted screenshot')
        }

        queryStore.setState((state) => ({
          tabs: {
            ...state.tabs,
            [activeTabId]: {
              ...state.tabs[activeTabId],
              sortColumn: 'name',
              sortDirection: 'asc',
            },
          },
        }))
      })

      await expect(
        page
          .getByTestId('result-grid-view')
          .locator('.ag-sort-ascending-icon:not(.ag-hidden)')
          .first()
      ).toBeVisible({ timeout: APP_READY_MS })

      await expect(page.getByTestId('result-grid-view')).toHaveScreenshot(
        `query-editor-result-grid-sorted-name-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('StatusBar — query info after execution', async ({ page }) => {
      await openQueryEditorWithResults(page)
      // The status bar should now show query rows/time info
      await expect(page.getByTestId('status-bar')).toHaveScreenshot(
        `status-bar-query-info-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('full app layout — query editor with results', async ({ page }) => {
      await openQueryEditorWithResults(page)
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('app-layout')).toHaveScreenshot(
        `app-full-layout-query-editor-results-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('QueryEditorTab — error state', async ({ page }) => {
      await openQueryEditorTab(page)

      // Enable query error simulation
      await page.evaluate(() => {
        ;(window as unknown as Record<string, unknown>).__mockQueryError__ = true
      })

      // Set content and execute
      await page.evaluate(() => {
        const wsStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
          getState: () => {
            tabsByConnection: Record<string, { id: string; type: string }[]>
          }
        }
        const activeTabs = wsStore.getState().tabsByConnection['session-playwright-1'] ?? []
        const queryTab = activeTabs.find((t) => t.type === 'query-editor')
        if (queryTab) {
          const qStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
            getState: () => { setContent: (id: string, c: string) => void }
          }
          qStore.getState().setContent(queryTab.id, 'SELECT * FROM nonexistent;')
        }
      })

      await page.waitForTimeout(300)
      await page.getByTestId('toolbar-execute').click()

      // Wait for error state to appear in the result panel
      await expect(page.getByTestId('result-panel')).toContainText("doesn't exist", {
        timeout: APP_READY_MS,
      })

      // Screenshot the error result panel
      await expect(page.getByTestId('result-panel')).toHaveScreenshot(
        `query-editor-result-panel-error-${theme}.png`,
        { animations: 'disabled' }
      )

      // Clean up error flag
      await page.evaluate(() => {
        delete (window as unknown as Record<string, unknown>).__mockQueryError__
      })
    })

    // --- Phase 5 view mode & export dialog screenshots ---

    test('ResultFormView — form view with record', async ({ page }) => {
      await openQueryEditorWithResults(page)
      // Switch to form view
      await page.getByTestId('view-mode-form').click()
      await expect(page.getByTestId('result-form-view')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('result-form-view')).toHaveScreenshot(
        `result-form-view-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('ResultTextView — text view', async ({ page }) => {
      await openQueryEditorWithResults(page)
      // Switch to text view
      await page.getByTestId('view-mode-text').click()
      await expect(page.getByTestId('result-text-view')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('result-text-view')).toHaveScreenshot(
        `result-text-view-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('ExportDialog — open', async ({ page }) => {
      await openQueryEditorWithResults(page)
      // Click the Export button
      await page.getByTestId('export-button').click()
      await expect(page.getByTestId('export-dialog')).toBeVisible({ timeout: APP_READY_MS })
      // Reset scroll positions for stable screenshots
      await page.getByTestId('object-browser-scroll').evaluate((el) => {
        el.scrollTop = 0
      })
      await page.evaluate(() => {
        window.scrollTo(0, 0)
      })
      // Screenshot the full viewport with the dialog modal visible
      await expect(page).toHaveScreenshot(`export-dialog-${theme}.png`, {
        animations: 'disabled',
      })
    })

    // --- Phase 6 Table Data Browser screenshots ---

    test('TableDataGrid — grid view with data', async ({ page }) => {
      await openTableDataTab(page)
      // Wait for the AG Grid to be rendered with data
      await expect(page.getByTestId('table-data-grid')).toBeVisible({ timeout: APP_READY_MS })
      // Wait for at least one data row to render
      await expect(page.getByTestId('table-data-grid').locator('.ag-row').first()).toBeVisible({
        timeout: APP_READY_MS,
      })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-data-tab')).toHaveScreenshot(
        `table-data-grid-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('TableDataFormView — form view with record', async ({ page }) => {
      await openTableDataTab(page)
      // Switch to form view
      await page.getByTestId('btn-form-view').click()
      await expect(page.getByTestId('table-data-form-view')).toBeVisible({ timeout: APP_READY_MS })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-data-tab')).toHaveScreenshot(
        `table-data-form-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('full app layout — table data grid', async ({ page }) => {
      await openTableDataTab(page)
      await expect(page.getByTestId('table-data-grid')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('table-data-grid').locator('.ag-row').first()).toBeVisible({
        timeout: APP_READY_MS,
      })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('app-layout')).toHaveScreenshot(
        `app-full-layout-table-data-grid-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('TableDataToolbar — toolbar controls', async ({ page }) => {
      await openTableDataTab(page)
      await expect(page.getByTestId('table-data-toolbar')).toHaveScreenshot(
        `table-data-toolbar-${theme}.png`,
        { animations: 'disabled' }
      )
    })
  })
}

// ---------------------------------------------------------------------------
// Date picker screenshot tests
// ---------------------------------------------------------------------------

test.describe('Date picker', () => {
  for (const theme of themes) {
    test.describe(`${theme} theme`, () => {
      test.beforeEach(async ({ page }) => {
        await waitForApp(page)
        await ensureTheme(page, theme)
      })

      test('DateTimePicker — Form View (calendar popup open)', async ({ page }) => {
        await openTableDataTab(page)

        // Switch to form view
        await page.getByTestId('btn-form-view').click()
        await expect(page.getByTestId('table-data-form-view')).toBeVisible({
          timeout: APP_READY_MS,
        })

        // Dismiss any lingering toasts before interaction
        await dismissAllToasts(page)

        // Click calendar button for created_at field
        const calendarBtn = page.getByTestId('calendar-btn-created_at')
        await expect(calendarBtn).toBeVisible({ timeout: APP_READY_MS })
        await calendarBtn.click()

        // Wait for picker popup to be fully visible
        await expect(page.getByTestId('date-time-picker-popup')).toBeVisible({
          timeout: APP_READY_MS,
        })
        await page.waitForTimeout(300) // Let animations settle

        // Dismiss any new toasts
        await dismissAllToasts(page)

        // Reset scroll positions for stable screenshots
        await resetChromeScrollPositions(page)

        // Full viewport screenshot — popup is a portal on body with position:fixed
        await expect(page).toHaveScreenshot(`date-picker-form-view-${theme}.png`, {
          animations: 'disabled',
        })

        // Close picker
        await page.keyboard.press('Escape')
      })

      test('DateTimePicker — Grid View (calendar popup open)', async ({ page }) => {
        await openTableDataTab(page)

        // Grid view is the default — wait for data rows
        await expect(page.getByTestId('table-data-grid')).toBeVisible({ timeout: APP_READY_MS })
        await expect(page.getByTestId('table-data-grid').locator('.ag-row').first()).toBeVisible({
          timeout: APP_READY_MS,
        })

        // Dismiss any lingering toasts before interaction
        await dismissAllToasts(page)

        // Click on the created_at cell in the first data row to start editing
        // AG Grid uses col-id attribute matching the field name
        const createdAtCell = page
          .getByTestId('table-data-grid')
          .locator('.ag-row[row-index="0"] .ag-cell[col-id="created_at"]')
        await expect(createdAtCell).toBeVisible({ timeout: APP_READY_MS })
        await createdAtCell.click()

        // Wait for the DateTimeCellEditor to mount with the calendar button
        const gridCalendarBtn = page.getByTestId('grid-calendar-btn')
        await expect(gridCalendarBtn).toBeVisible({ timeout: APP_READY_MS })

        // Click calendar button to open picker
        await gridCalendarBtn.click()

        // Wait for picker popup to be fully visible
        await expect(page.getByTestId('date-time-picker-popup')).toBeVisible({
          timeout: APP_READY_MS,
        })
        await page.waitForTimeout(300) // Let animations settle

        // Dismiss any new toasts
        await dismissAllToasts(page)

        // Reset scroll positions for stable screenshots
        await resetChromeScrollPositions(page)

        // Full viewport screenshot — popup is a portal on body with position:fixed
        await expect(page).toHaveScreenshot(`date-picker-grid-view-${theme}.png`, {
          animations: 'disabled',
        })

        // Close picker
        await page.keyboard.press('Escape')
      })
    })
  }
})
