import { test, expect, type Locator, type Page } from '@playwright/test'
import { APP_READY_MS, getColumnIndexByName, waitForApp } from './helpers'

const themes = ['light', 'dark'] as const
const AUTOCOMPLETE_OPEN_RETRIES = 4
const AUTOCOMPLETE_OPEN_TIMEOUT_MS = 1_500
const AUTOCOMPLETE_RETRY_DELAY_MS = 300

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

async function getUnionClip(page: Page, locators: Locator[], padding = 8) {
  const boxes = (await Promise.all(locators.map((locator) => locator.boundingBox()))).filter(
    (box): box is NonNullable<Awaited<ReturnType<Locator['boundingBox']>>> => box !== null
  )

  if (boxes.length === 0) {
    throw new Error('Could not compute screenshot clip: no visible bounding boxes found')
  }

  const viewport = page.viewportSize()
  if (!viewport) {
    throw new Error('Could not compute screenshot clip: missing viewport size')
  }

  const x = Math.max(0, Math.min(...boxes.map((box) => box.x)) - padding)
  const y = Math.max(0, Math.min(...boxes.map((box) => box.y)) - padding)
  const right = Math.min(
    viewport.width,
    Math.max(...boxes.map((box) => box.x + box.width)) + padding
  )
  const bottom = Math.min(
    viewport.height,
    Math.max(...boxes.map((box) => box.y + box.height)) + padding
  )

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  }
}

async function openConnectionManager(page: Page) {
  const btn = page.getByRole('button', { name: 'New Connection' }).first()
  const dialog = page.getByTestId('connection-dialog')

  // The click → Zustand update → React effect → showModal() chain can be delayed
  // under load.  Retry the click once if the dialog doesn't appear promptly.
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

/** Stacked toasts aligned with `.agent/design/toast_notifications_*` copy — for visual regression only. */
async function showDesignReferenceToasts(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__toastStore__ as {
      getState: () => {
        showWarning: (t: string, m?: string) => void
        showError: (t: string, m?: string) => void
        showSuccess: (t: string, m?: string) => void
      }
    }
    const { showWarning, showError, showSuccess } = store.getState()
    showWarning('Update Available', 'SQL Architect v2.5.1 is ready for installation.')
    showError('Authentication Error', 'Invalid credentials for user: admin@localhost')
    showSuccess('Query Executed', 'Successfully retrieved 450 rows in 12ms.')
  })
}

async function connectToSample(page: Page) {
  await openConnectionManager(page)
  await page
    .getByTestId('connection-dialog')
    .getByRole('button', { name: /Sample MySQL/ })
    .click()
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
  await page.waitForTimeout(300)

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

/** Open a table data tab for `sample_table` and wait for data to load. */
async function openTableDataTab(page: Page) {
  await connectToSample(page)

  // Programmatically open a table-data tab via the workspace store
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { openTab: (tab: Record<string, unknown>) => void }
    }
    store.getState().openTab({
      type: 'table-data',
      label: 'sample_table',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'sample_table',
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

/** Open a table data tab for the `orders` table and wait for data to load. */
async function openOrdersTableDataTab(page: Page) {
  await connectToSample(page)

  // Programmatically open a table-data tab via the workspace store
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { openTab: (tab: Record<string, unknown>) => void }
    }
    store.getState().openTab({
      type: 'table-data',
      label: 'orders',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'orders',
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

async function openTableDesignerTab(page: Page) {
  await connectToSample(page)

  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { openTab: (tab: Record<string, unknown>) => void }
    }
    store.getState().openTab({
      type: 'table-designer',
      label: 'users',
      connectionId: 'session-playwright-1',
      mode: 'alter',
      databaseName: 'ecommerce_db',
      objectName: 'users',
    })
  })

  await expect(page.getByTestId('table-designer-tab')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('column-editor')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.locator('input[value="username"]').first()).toBeVisible({
    timeout: APP_READY_MS,
  })
}

async function markActiveTableDesignerDirty(page: Page) {
  await page.evaluate(() => {
    const workspaceStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => {
        activeTabByConnection: Record<string, string | null>
        tabsByConnection: Record<string, { id: string; type: string }[]>
      }
    }
    const tableDesignerStore = (window as unknown as Record<string, unknown>)
      .__tableDesignerStore__ as {
      setState: (
        updater: (state: { tabs: Record<string, Record<string, unknown>> }) => {
          tabs: Record<string, Record<string, unknown>>
        }
      ) => void
    }

    const workspaceState = workspaceStore.getState()
    const activeTabId =
      workspaceState.activeTabByConnection['session-playwright-1'] ??
      workspaceState.tabsByConnection['session-playwright-1']?.find(
        (tab) => tab.type === 'table-designer'
      )?.id

    if (!activeTabId) {
      throw new Error('No active table designer tab found')
    }

    tableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        [activeTabId]: {
          ...state.tabs[activeTabId],
          isDirty: true,
          isDdlLoading: false,
          ddlError: null,
          ddlWarnings: [],
          ddl:
            state.tabs[activeTabId]?.ddl ||
            'ALTER TABLE `mock_db`.`users`\n  MODIFY COLUMN `email` VARCHAR(320) NOT NULL;',
        },
      },
    }))
  })

  await expect(page.getByTestId('table-designer-apply')).toBeEnabled({ timeout: APP_READY_MS })
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
        { animations: 'disabled', timeout: APP_READY_MS }
      )
    })

    test('TestConnectionResult — after successful test', async ({ page }) => {
      await openConnectionManager(page)
      await page
        .getByTestId('connection-dialog')
        .getByRole('button', { name: /Sample MySQL/ })
        .click()
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
      const formMain = page.getByTestId('connection-form-main')
      await formMain.locator('#conn-group').click()
      await expect(page.getByRole('listbox', { name: 'Group' })).toBeVisible()
      await expect(formMain).toHaveScreenshot(`group-dropdown-open-${theme}.png`)
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
      await expect(page.getByTestId('ctx-create-table')).toBeVisible()

      await expect(page.getByTestId('object-browser-context-menu')).toHaveScreenshot(
        `context-menu-database-${theme}.png`
      )
    })

    test('ObjectBrowserContextMenu — table node with design action', async ({ page }) => {
      await connectToSample(page)

      // Expand database and Tables category to reach table nodes
      await page.getByText('ecommerce_db').first().click()
      await expect(page.getByText('Tables')).toBeVisible()
      await page.getByText('Tables').click()
      await expect(page.getByText('users')).toBeVisible()

      // Right-click on a table node
      await page.getByText('users').click({ button: 'right' })
      await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()
      await expect(page.getByTestId('ctx-design-table')).toBeEnabled()

      await expect(page.getByTestId('object-browser-context-menu')).toHaveScreenshot(
        `object-browser-table-context-menu-${theme}.png`
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

    test('QueryEditorTab — running state toolbar', async ({ page }) => {
      await openQueryEditorTab(page)

      // Set SQL content
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
          qStore.getState().setContent(queryTab.id, 'SELECT * FROM users;')
        }
      })
      await page.waitForTimeout(300)

      // Set a very long delay so query stays running for the screenshot
      await page.evaluate(() => {
        ;(window as unknown as Record<string, unknown>).__mockQueryDelay__ = 60000
      })

      // Execute the query
      await page.getByTestId('toolbar-execute').click()

      // Wait for running indicator to be visible
      await expect(page.getByTestId('running-indicator')).toBeVisible({ timeout: APP_READY_MS })

      // Screenshot the toolbar in running state
      await expect(page.getByTestId('editor-toolbar')).toHaveScreenshot(
        `query-editor-toolbar-running-${theme}.png`,
        { animations: 'disabled' }
      )

      // Clean up: cancel the pending query by clearing the delay and rejecting
      await page.evaluate(() => {
        const pendingReject = (window as unknown as Record<string, unknown>)
          .__pendingQueryReject__ as ((reason: Error) => void) | null
        if (pendingReject) {
          pendingReject(new Error('Screenshot cleanup'))
          ;(window as unknown as Record<string, unknown>).__pendingQueryReject__ = null
        }
        delete (window as unknown as Record<string, unknown>).__mockQueryDelay__
      })
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

      // react-data-grid renders Phosphor ArrowUp SVG for ASC sort via SortStatusRenderer
      await expect(
        page.getByTestId('result-grid-view').locator('.rdg-header-row svg').first()
      ).toBeVisible({ timeout: APP_READY_MS })

      await expect(page.getByTestId('result-grid-view')).toHaveScreenshot(
        `query-editor-result-grid-sorted-name-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('QueryEditorTab — edit mode toolbar with detected tables', async ({ page }) => {
      await openQueryEditorWithResults(page)
      // Wait for analysis to complete — dropdown should be visible with "Read Only"
      await expect(page.getByTestId('edit-mode-dropdown')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('result-toolbar')).toHaveScreenshot(
        `query-editor-result-toolbar-edit-mode-dropdown-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('QueryEditorTab — grid with edit mode active (lock icons, dimmed non-editable)', async ({
      page,
    }) => {
      await openQueryEditorWithResults(page)
      // Wait for analysis to populate detected tables
      await expect(page.getByTestId('edit-mode-dropdown')).toBeVisible({ timeout: APP_READY_MS })

      // Select the detected table for editing
      await page.getByTestId('edit-mode-dropdown').click()
      await page.getByRole('option').nth(1).click()

      // Wait for edit mode to apply — look for read-only column header lock icons
      await expect(
        page.getByTestId('result-grid-view').locator('.rdg-readonly-cell').first()
      ).toBeVisible({ timeout: APP_READY_MS })

      await expect(page.getByTestId('result-grid-view')).toHaveScreenshot(
        `query-editor-result-grid-edit-mode-${theme}.png`,
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

    test('ResultFormView — form view in edit mode (editable vs non-editable fields)', async ({
      page,
    }) => {
      await openQueryEditorWithResults(page)
      // Wait for analysis to populate detected tables
      await expect(page.getByTestId('edit-mode-dropdown')).toBeVisible({ timeout: APP_READY_MS })

      // Select the detected table for editing
      await page.getByTestId('edit-mode-dropdown').click()
      await page.getByRole('option').nth(1).click()

      // Wait for edit mode to apply
      await expect(
        page.getByTestId('result-grid-view').locator('.rdg-readonly-cell').first()
      ).toBeVisible({ timeout: APP_READY_MS })

      // Switch to form view
      await page.getByTestId('view-mode-form').click()
      await expect(page.getByTestId('result-form-view')).toBeVisible({ timeout: APP_READY_MS })

      // Click on an editable field to start editing the row
      const editableInput = page.getByTestId('form-input-name')
      await expect(editableInput).toBeVisible({ timeout: APP_READY_MS })
      await editableInput.click()

      // Wait for save/discard buttons to appear (always visible in edit mode)
      await expect(page.getByTestId('btn-form-save')).toBeVisible({ timeout: APP_READY_MS })

      await expect(page.getByTestId('result-form-view')).toHaveScreenshot(
        `result-form-view-edit-mode-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('ResultFormView — FK trigger visible in edit mode', async ({ page }) => {
      await openQueryEditorWithResults(page)
      await expect(page.getByTestId('edit-mode-dropdown')).toBeVisible({ timeout: APP_READY_MS })

      await page.getByTestId('edit-mode-dropdown').click()
      await page.getByRole('option').nth(1).click()

      await page.getByTestId('view-mode-form').click()
      await expect(page.getByTestId('result-form-view')).toBeVisible({ timeout: APP_READY_MS })

      const editableInput = page.getByTestId('form-input-name')
      await editableInput.click()
      await expect(page.getByTestId('fk-lookup-trigger')).toBeVisible({ timeout: APP_READY_MS })

      await expect(page.getByTestId('result-form-view')).toHaveScreenshot(
        `result-form-view-fk-trigger-${theme}.png`,
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
      // Wait for the react-data-grid to be rendered with data
      await expect(page.getByTestId('table-data-grid')).toBeVisible({ timeout: APP_READY_MS })
      // Wait for at least one data row to render
      await expect(page.getByTestId('table-data-grid').locator('.rdg-row').first()).toBeVisible({
        timeout: APP_READY_MS,
      })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-data-tab')).toHaveScreenshot(
        `table-data-grid-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('TableDataGrid — FK column header (orders table with user_id FK)', async ({ page }) => {
      await openOrdersTableDataTab(page)
      const grid = page.getByTestId('table-data-grid')
      await expect(grid).toBeVisible({ timeout: APP_READY_MS })
      await expect(grid.locator('.rdg-row').first()).toBeVisible({ timeout: APP_READY_MS })
      // Wait for FK metadata to load (async fire-and-forget in store)
      await page.waitForTimeout(500)
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-data-tab')).toHaveScreenshot(
        `table-data-grid-fk-header-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('TableDataGrid — FK trigger button visible on row hover (orders table)', async ({
      page,
    }) => {
      await openOrdersTableDataTab(page)
      const grid = page.getByTestId('table-data-grid')
      await expect(grid).toBeVisible({ timeout: APP_READY_MS })
      await expect(grid.locator('.rdg-row').first()).toBeVisible({ timeout: APP_READY_MS })
      // Wait for FK metadata to load (async fire-and-forget in store)
      await page.waitForTimeout(500)
      // Hover over the first data row to trigger the FK button CSS visibility
      await grid.locator('.rdg-row').first().hover()
      await page.waitForTimeout(200) // Let CSS transition settle
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-data-tab')).toHaveScreenshot(
        `table-data-grid-fk-trigger-hover-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('FkLookupDialog — open with data loaded (orders table)', async ({ page }) => {
      await openOrdersTableDataTab(page)
      const grid = page.getByTestId('table-data-grid')
      await expect(grid).toBeVisible({ timeout: APP_READY_MS })
      await expect(grid.locator('.rdg-row').first()).toBeVisible({ timeout: APP_READY_MS })
      // Wait for FK metadata to load (async fire-and-forget in store)
      await page.waitForTimeout(500)
      // Hover over the first data row to make the FK trigger button visible
      await grid.locator('.rdg-row').first().hover()
      await page.waitForTimeout(200) // Let CSS transition settle
      // Click the FK lookup trigger button
      const fkTrigger = page.getByTestId('fk-lookup-trigger').first()
      await expect(fkTrigger).toBeVisible({ timeout: APP_READY_MS })
      await fkTrigger.click()
      // Wait for the FK lookup dialog to appear and data to load
      await expect(page.getByTestId('fk-lookup-dialog')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('fk-lookup-base-grid')).toBeVisible({ timeout: APP_READY_MS })
      // Reset scroll positions for stable screenshots
      await resetChromeScrollPositions(page)
      // Full viewport screenshot — dialog is a modal
      await expect(page).toHaveScreenshot(`fk-lookup-dialog-open-${theme}.png`, {
        animations: 'disabled',
      })
    })

    test('TableDataFormView — form view with record', async ({ page }) => {
      await openTableDataTab(page)
      // Switch to form view
      await page.getByTestId('view-mode-form').click()
      await expect(page.getByTestId('table-data-form-view')).toBeVisible({ timeout: APP_READY_MS })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-data-tab')).toHaveScreenshot(
        `table-data-form-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('TableDataFormView — FK trigger visible for orders table', async ({ page }) => {
      await openOrdersTableDataTab(page)
      await page.getByTestId('view-mode-form').click()
      await expect(page.getByTestId('table-data-form-view')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('fk-lookup-trigger')).toBeVisible({ timeout: APP_READY_MS })

      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-data-tab')).toHaveScreenshot(
        `table-data-form-fk-trigger-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('full app layout — table data grid', async ({ page }) => {
      await openTableDataTab(page)
      await expect(page.getByTestId('table-data-grid')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('table-data-grid').locator('.rdg-row').first()).toBeVisible({
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

    test('TableDataGrid — enum dropdown open', async ({ page }) => {
      await openTableDataTab(page)

      const grid = page.getByTestId('table-data-grid')
      await expect(grid).toBeVisible({ timeout: APP_READY_MS })
      await expect(grid.locator('.rdg-row').first()).toBeVisible({ timeout: APP_READY_MS })

      const statusColIdx = await getColumnIndexByName(grid, 'status')
      expect(statusColIdx).toBeGreaterThanOrEqual(0)

      const statusCell = grid.locator('.rdg-row').first().locator('.rdg-cell').nth(statusColIdx)
      await expect(statusCell).toBeVisible({ timeout: APP_READY_MS })
      await statusCell.click()

      const enumEditor = page.locator('.td-cell-editor-select').first()
      await expect(enumEditor).toBeVisible({ timeout: APP_READY_MS })
      await enumEditor.click()

      const listbox = page.getByRole('listbox', { name: 'status' })
      await expect(listbox).toBeVisible({ timeout: APP_READY_MS })

      const clip = await getUnionClip(page, [statusCell, listbox])
      await expect(await page.screenshot({ animations: 'disabled', clip })).toMatchSnapshot(
        `table-data-grid-enum-dropdown-open-${theme}.png`
      )
    })

    test('TableDataToolbar — page size dropdown open', async ({ page }) => {
      await openTableDataTab(page)
      await page.getByTestId('page-size-select').click()
      const listbox = page.getByRole('listbox', { name: 'Page size' })
      await expect(listbox).toBeVisible({
        timeout: APP_READY_MS,
      })
      const clip = await getUnionClip(page, [page.getByTestId('table-data-toolbar'), listbox])
      await expect(await page.screenshot({ animations: 'disabled', clip })).toMatchSnapshot(
        `table-data-toolbar-page-size-open-${theme}.png`
      )
    })

    test('TableDesignerTab — columns view', async ({ page }) => {
      await openTableDesignerTab(page)
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-designer-tab')).toHaveScreenshot(
        `table-designer-columns-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('TableDesignerTab — DDL Preview sub-tab', async ({ page }) => {
      await openTableDesignerTab(page)
      await page.getByRole('button', { name: 'DDL Preview' }).click()
      await expect(page.getByTestId('table-designer-ddl-preview')).toBeVisible({
        timeout: APP_READY_MS,
      })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-designer-tab')).toHaveScreenshot(
        `table-designer-ddl-preview-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('table-designer-indexes', async ({ page }) => {
      await openTableDesignerTab(page)
      await page.getByRole('button', { name: 'Indexes' }).click()
      await expect(page.getByTestId('index-editor')).toBeVisible({ timeout: APP_READY_MS })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-designer-tab')).toHaveScreenshot(
        `table-designer-indexes-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('table-designer-indexes — columns selector summary', async ({ page }) => {
      await openTableDesignerTab(page)
      await page.getByRole('button', { name: 'Indexes' }).click()
      await expect(page.getByTestId('index-editor')).toBeVisible({ timeout: APP_READY_MS })

      await page.getByTestId('index-editor-add').click()
      await page.getByTestId('index-columns-button-1').click()
      await page.getByRole('option', { name: 'id' }).click()
      await page.getByRole('option', { name: 'username' }).click()
      await page.getByRole('option', { name: 'email' }).click()
      await page.getByTestId('index-row-1').click()

      await expect(page.getByTestId('index-columns-button-1')).toContainText('3 selected', {
        timeout: APP_READY_MS,
      })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-designer-tab')).toHaveScreenshot(
        `table-designer-indexes-summary-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('table-designer-fks', async ({ page }) => {
      await openTableDesignerTab(page)
      await page.getByRole('button', { name: 'Foreign Keys' }).click()
      await expect(page.getByTestId('foreign-key-editor')).toBeVisible({ timeout: APP_READY_MS })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-designer-tab')).toHaveScreenshot(
        `table-designer-fks-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('table-designer-properties', async ({ page }) => {
      await openTableDesignerTab(page)
      await page.getByRole('button', { name: 'Table Properties' }).click()
      await expect(page.getByTestId('table-properties-editor')).toBeVisible({
        timeout: APP_READY_MS,
      })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-designer-tab')).toHaveScreenshot(
        `table-designer-properties-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('TableDesignerTab — Apply Schema Changes dialog', async ({ page }) => {
      await openTableDesignerTab(page)
      await markActiveTableDesignerDirty(page)
      await page.getByTestId('table-designer-apply').click()
      await expect(page.getByTestId('apply-schema-dialog')).toBeVisible({ timeout: APP_READY_MS })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('apply-schema-dialog')).toHaveScreenshot(
        `table-designer-apply-dialog-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    // --- Filter Dialog screenshots ---

    test('FilterDialog — empty state', async ({ page }) => {
      await openTableDataTab(page)
      // Open filter dialog
      await page.getByTestId('btn-filter').click()
      await expect(page.getByTestId('filter-dialog')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('filter-empty-state')).toBeVisible()

      // Reset scroll positions for stable screenshots
      await resetChromeScrollPositions(page)

      // Full viewport screenshot — dialog is a modal
      await expect(page).toHaveScreenshot(`filter-dialog-empty-${theme}.png`, {
        animations: 'disabled',
      })
    })

    test('FilterDialog — with conditions', async ({ page }) => {
      await openTableDataTab(page)
      // Open filter dialog
      await page.getByTestId('btn-filter').click()
      await expect(page.getByTestId('filter-dialog')).toBeVisible({ timeout: APP_READY_MS })

      // Add a condition
      await page.getByTestId('filter-add-button').first().click()
      await expect(page.getByTestId('filter-row')).toBeVisible({ timeout: APP_READY_MS })

      // Set values for the condition
      await page.getByTestId('filter-column-select-0').click()
      await page.getByRole('option', { name: 'name', exact: true }).click()
      await page.getByTestId('filter-operator-select-0').click()
      await page.getByRole('option', { name: 'LIKE', exact: true }).click()
      await page.getByTestId('filter-value-input').fill('%test%')

      // Blur any focused input for stable screenshot
      await page.evaluate(() => {
        const el = document.activeElement
        if (el && el instanceof HTMLElement) el.blur()
      })

      // Reset scroll positions for stable screenshots
      await resetChromeScrollPositions(page)

      // Full viewport screenshot — dialog with condition rows
      await expect(page).toHaveScreenshot(`filter-dialog-with-conditions-${theme}.png`, {
        animations: 'disabled',
      })
    })

    // --- Object Editor screenshots (Phase 8.6) ---

    test('ObjectEditorTab — alter mode (procedure DDL)', async ({ page }) => {
      await connectToSample(page)

      // Open an object-editor tab in alter mode via the workspace store
      await page.evaluate(() => {
        const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
          getState: () => { openTab: (tab: Record<string, unknown>) => void }
        }
        store.getState().openTab({
          type: 'object-editor',
          label: 'Stored Procedure: sp_get_orders',
          connectionId: 'session-playwright-1',
          databaseName: 'ecommerce_db',
          objectName: 'sp_get_orders',
          objectType: 'procedure',
          mode: 'alter',
        })
      })

      await expect(page.getByTestId('object-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('object-editor-toolbar')).toBeVisible({ timeout: APP_READY_MS })
      // Wait for DDL to load (alter mode fetches from mock)
      await expect(page.getByTestId('object-editor-tab')).toContainText('CREATE PROCEDURE', {
        timeout: APP_READY_MS,
      })

      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('object-editor-tab')).toHaveScreenshot(
        `object-editor-alter-procedure-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('ObjectEditorTab — create mode (new procedure template)', async ({ page }) => {
      await connectToSample(page)

      // Open an object-editor tab in create mode via the workspace store
      await page.evaluate(() => {
        const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
          getState: () => { openTab: (tab: Record<string, unknown>) => void }
        }
        store.getState().openTab({
          type: 'object-editor',
          label: 'New Stored Procedure',
          connectionId: 'session-playwright-1',
          databaseName: 'ecommerce_db',
          objectName: 'procedure_name',
          objectType: 'procedure',
          mode: 'create',
        })
      })

      await expect(page.getByTestId('object-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('object-editor-toolbar')).toBeVisible({ timeout: APP_READY_MS })
      // Wait for template content to load (create mode uses template)
      await expect(page.getByTestId('object-editor-tab')).toContainText('CREATE PROCEDURE', {
        timeout: APP_READY_MS,
      })

      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('object-editor-tab')).toHaveScreenshot(
        `object-editor-create-procedure-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('ObjectBrowserContextMenu — procedure node (non-read-only)', async ({ page }) => {
      await connectToSample(page)

      // Expand database and Procedures category
      await page.getByText('ecommerce_db').first().click()
      await expect(page.getByText('Procedures')).toBeVisible({ timeout: APP_READY_MS })
      await page.getByText('Procedures', { exact: true }).click()
      await expect(page.getByText('sp_get_orders')).toBeVisible({ timeout: APP_READY_MS })

      // Right-click on the procedure node
      await page.getByText('sp_get_orders').click({ button: 'right' })
      await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

      await expect(page.getByTestId('object-browser-context-menu')).toHaveScreenshot(
        `context-menu-procedure-${theme}.png`
      )
    })

    test('ObjectBrowserContextMenu — view node (non-read-only)', async ({ page }) => {
      await connectToSample(page)

      // Expand database and Views category
      await page.getByText('ecommerce_db').first().click()
      await expect(page.getByText('Views')).toBeVisible({ timeout: APP_READY_MS })
      await page.getByText('Views', { exact: true }).click()
      await expect(page.getByText('user_stats_view')).toBeVisible({ timeout: APP_READY_MS })

      // Right-click on the view node
      await page.getByText('user_stats_view').click({ button: 'right' })
      await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

      await expect(page.getByTestId('object-browser-context-menu')).toHaveScreenshot(
        `context-menu-view-${theme}.png`
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
        await page.getByTestId('view-mode-form').click()
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

        // Grid view is the default — wait for data rows (react-data-grid)
        await expect(page.getByTestId('table-data-grid')).toBeVisible({ timeout: APP_READY_MS })
        await expect(page.getByTestId('table-data-grid').locator('.rdg-row').first()).toBeVisible({
          timeout: APP_READY_MS,
        })

        // Dismiss any lingering toasts before interaction
        await dismissAllToasts(page)

        // Click on the created_at cell in the first data row to start editing.
        // The grid enters edit mode on single click via its custom onCellClick
        // handler. Avoid double-click here: once the editor mounts, the second
        // click can land on inline controls (NULL toggle / calendar button)
        // inside narrow temporal cells and flip the editor into an unintended
        // state before the screenshot is taken.
        const headerCells = page.getByTestId('table-data-grid').locator('.rdg-header-row .rdg-cell')
        const headerCount = await headerCells.count()
        let createdAtColIdx = -1
        for (let i = 0; i < headerCount; i++) {
          const text = await headerCells.nth(i).textContent()
          if (text?.trim() === 'created_at') {
            createdAtColIdx = i
            break
          }
        }
        expect(createdAtColIdx).toBeGreaterThanOrEqual(0)
        const firstRow = page.getByTestId('table-data-grid').locator('.rdg-row').first()
        const createdAtCell = firstRow.locator('.rdg-cell').nth(createdAtColIdx)
        await expect(createdAtCell).toBeVisible({ timeout: APP_READY_MS })
        await createdAtCell.click()
        // The editor opening is async (guard → startEditing → selectCell) — wait a bit
        await page.waitForTimeout(500)

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
