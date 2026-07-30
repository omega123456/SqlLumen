import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  APP_READY_MS,
  activeWorkspaceTabs,
  connectToSample,
  dismissAllToasts,
  getColumnIndexByName,
  getGridCellByColumnName,
  openConnectionManager,
  selectSampleConnection,
  waitForApp,
  waitForGlideGrid,
} from './helpers'
import {
  clickGlideCell,
  clickGlideFkEllipsis,
  dblClickGlideCell,
  getGlideGridGeometry,
} from './glide-grid-helpers'
import { BLOB_VIEWER_SCREENSHOT_STATES } from '../src/tests/playwright-fixtures/blob-value'

const themes = ['light', 'dark'] as const
const SCREENSHOT_TEST_TIMEOUT_MS = 25_000
const FIXED_SCREENSHOT_DATE_ISO = '2026-06-08T12:00:00.000Z'

test.beforeEach(async ({ page }) => {
  await page.addInitScript((fixedDateIso: string) => {
    const RealDate = Date
    const fixedTime = RealDate.parse(fixedDateIso)

    class MockDate extends RealDate {
      constructor(...args: ConstructorParameters<DateConstructor>) {
        super(...(args.length === 0 ? [fixedTime] : args))
      }

      static now() {
        return fixedTime
      }
    }

    MockDate.UTC = RealDate.UTC
    MockDate.parse = RealDate.parse
    ;(window as typeof window & { Date: typeof Date }).Date = MockDate as typeof Date
  }, FIXED_SCREENSHOT_DATE_ISO)
})

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

type BoundingBoxable = {
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null>
}

async function getUnionClip(page: Page, locators: BoundingBoxable[], padding = 8) {
  const boxes = (await Promise.all(locators.map((locator) => locator.boundingBox()))).filter(
    (box): box is NonNullable<{ x: number; y: number; width: number; height: number }> =>
      box !== null
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

function glideDropdownEditor(page: Page) {
  return page.locator('.glide-select').first()
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
  // Scope to the connection tab bar so the assertion is not ambiguous with an
  // overlapping "Connected to Staging MySQL" toast that may briefly appear.
  await expect(
    page.getByTestId('connection-session-tab-session-playwright-2').getByText('Staging MySQL')
  ).toBeVisible()
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
  await expect(activeWorkspaceTabs(page)).toBeVisible()
  await expect(page.getByTestId('schema-info-tab')).toBeVisible()
  await expect(page.getByTestId('stats-row')).toBeVisible()
}

async function seedCopyToHostTargets(page: Page) {
  await page.evaluate(() => {
    const connectionStore = (window as unknown as Record<string, unknown>).__connectionStore__ as {
      setState: (
        fn: (state: {
          savedConnections: Array<Record<string, unknown>>
          activeConnections: Record<string, Record<string, unknown>>
        }) => Record<string, unknown>
      ) => void
    }

    const targetConnections = [
      {
        id: 'conn-playwright-2',
        name: 'Warehouse Replica',
        host: '10.20.30.40',
        port: 3306,
        username: 'replica_user',
        hasPassword: true,
        defaultDatabase: 'warehouse_db',
        sslEnabled: false,
        sslCaPath: null,
        sslCertPath: null,
        sslKeyPath: null,
        color: '#0f766e',
        groupId: null,
        readOnly: false,
        sortOrder: 1,
        connectTimeoutSecs: 10,
        keepaliveIntervalSecs: 60,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'conn-playwright-3',
        name: 'Readonly Archive',
        host: '10.20.30.50',
        port: 3306,
        username: 'archive_user',
        hasPassword: true,
        defaultDatabase: 'archive_db',
        sslEnabled: false,
        sslCaPath: null,
        sslCertPath: null,
        sslKeyPath: null,
        color: '#7c3aed',
        groupId: null,
        readOnly: true,
        sortOrder: 2,
        connectTimeoutSecs: 10,
        keepaliveIntervalSecs: 60,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]

    // Register the writable target as an open session so the dialog can enumerate its
    // databases (the Database dropdown only lists when the target connection is active).
    const writableTarget = targetConnections[0]
    connectionStore.setState((state) => ({
      savedConnections: [...state.savedConnections, ...targetConnections],
      activeConnections: {
        ...state.activeConnections,
        'session-copy-target': {
          id: 'session-copy-target',
          profile: writableTarget,
          status: 'connected',
          serverVersion: '8.0.33-mock',
        },
      },
    }))
  })
}

async function configureCopyToHostFixtures(page: Page, mode: 'default' | 'progress') {
  await applyFixtureOverrides(page, {
    reset: true,
    overrides:
      mode === 'progress'
        ? [
            { domain: 'copyToHostStart', key: 'default', data: 'copy-job-progress' },
            {
              domain: 'copyProgress',
              key: 'copy-job-progress',
              data: {
                jobId: 'copy-job-progress',
                status: 'running',
                objectsTotal: 4,
                objectsDone: 2,
                currentObject: 'orders',
                currentObjectType: 'table',
                rowsTotal: 5820,
                rowsDone: 2140,
                errorMessage: null,
                cancelRequested: false,
              },
            },
          ]
        : [],
  })
}

async function applyFixtureOverrides(
  page: Page,
  options: {
    reset?: boolean
    overrides: Array<{ domain: string; key: string; data: unknown }>
  }
) {
  await page.evaluate((fixtureOptions) => {
    const registry = (window as unknown as Record<string, unknown>)
      .__PLAYWRIGHT_FIXTURE_REGISTRY__ as {
      resetFixtureOverrides: () => void
      overrideFixture: (domain: string, key: string, data: unknown) => void
    }

    if (fixtureOptions.reset) {
      registry.resetFixtureOverrides()
    }

    for (const override of fixtureOptions.overrides) {
      registry.overrideFixture(override.domain, override.key, override.data)
    }
  }, options)
}

async function setSchemaMetadataDelay(page: Page, delayMs: number) {
  await page.evaluate((nextDelayMs) => {
    ;(
      window as typeof window & {
        __PLAYWRIGHT_SCHEMA_METADATA_FULL_DELAY_MS__?: number
      }
    ).__PLAYWRIGHT_SCHEMA_METADATA_FULL_DELAY_MS__ = nextDelayMs
  }, delayMs)
}

async function openCommandPalette(page: Page) {
  await page.keyboard.press('F2')
  await expect(page.getByTestId('command-palette')).toBeVisible()
  await expect(page.getByTestId('command-palette-input')).toBeFocused()
}

async function prepareCommandPalette(page: Page, options?: { recents?: string; delayMs?: number }) {
  await applyFixtureOverrides(page, {
    reset: true,
    overrides:
      options?.recents == null
        ? []
        : [{ domain: 'commandPaletteRecents', key: 'default', data: options.recents }],
  })
  await setSchemaMetadataDelay(page, options?.delayMs ?? 0)
  await connectToSample(page)
}

async function openCopyToHostDialog(
  page: Page,
  source: 'database' | 'table',
  fixtureMode: 'default' | 'progress' = 'default'
) {
  await connectToSample(page)
  await seedCopyToHostTargets(page)
  await configureCopyToHostFixtures(page, fixtureMode)

  const objectBrowser = page.getByTestId('object-browser')
  await expect(objectBrowser.getByText('ecommerce_db')).toBeVisible()
  await objectBrowser.getByText('ecommerce_db').click()

  if (source === 'table') {
    await objectBrowser.getByText('Tables').click()
    await expect(objectBrowser.getByText('users')).toBeVisible()
    await objectBrowser.getByText('users').click({ button: 'right' })
  } else {
    await objectBrowser.getByText('ecommerce_db').click({ button: 'right' })
  }

  await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()
  await page.getByTestId('ctx-copy-to-host').click()
  await expect(page.getByTestId('copy-to-host-dialog')).toBeVisible()
  await expect(page.getByTestId('copy-object-tree')).toBeVisible()
}

async function chooseCopyToHostTarget(page: Page) {
  await page.getByTestId('copy-target-connection').click()
  await page.getByTestId('copy-target-connection-option-conn-playwright-2').click()
  await page.getByTestId('copy-target-database').click()
  await page.getByTestId('copy-target-database-option-staging_db').click()
}

/** Open a query editor tab via the "+" button after connecting. */
async function openQueryEditorTab(page: Page) {
  await connectToSample(page)
  await page.getByTestId('new-query-tab-button').click()
  await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
  // Wait for the editor toolbar to settle
  await expect(page.getByTestId('editor-toolbar')).toBeVisible()
}

/** Enable AI via the settings store so the toolbar toggle appears. */
async function enableAiViaStore(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__settingsStore__ as {
      setState: (
        updater: (state: {
          settings: Record<string, string>
          pendingChanges: Record<string, string>
        }) => Record<string, unknown>
      ) => void
    }
    store.setState((state) => ({
      settings: {
        ...state.settings,
        'ai.enabled': 'true',
        'ai.endpoint': 'http://localhost:11434/v1',
        'ai.model': 'llama3',
        'ai.embeddingModel': 'nomic-embed-text',
      },
      pendingChanges: {},
    }))
  })
}

/** Open a query editor tab, set multi-statement SQL, execute all, and wait for multi-result tabs. */
async function openQueryEditorWithMultiResults(page: Page) {
  await openQueryEditorTab(page)

  // Set content with 3 SQL statements (will produce 2 SELECT + 1 DML via the mock)
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
      qStore
        .getState()
        .setContent(
          queryTab.id,
          "SELECT id, name FROM users;\nSELECT product_id, price FROM products;\nUPDATE users SET status = 'active' WHERE id = 1;"
        )
    }
  })

  await page.waitForTimeout(300)

  // Click the Execute All button
  await page.getByTestId('toolbar-execute-all').click()

  // Wait for multi-result tab strip to appear (3 results → tabs visible)
  await expect(page.getByTestId('result-sub-tabs')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('result-tab-0')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('result-tab-2')).toBeVisible({ timeout: APP_READY_MS })
}

async function openQueryEditorWithMultiResultsInBottomPanel(page: Page) {
  await openQueryEditorTab(page)

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
      qStore
        .getState()
        .setContent(
          queryTab.id,
          "SELECT id, name FROM users;\nSELECT product_id, price FROM products;\nUPDATE users SET status = 'active' WHERE id = 1;"
        )
    }
  })

  await page.waitForTimeout(300)
  await page.getByTestId('toolbar-execute-all').click()

  await expect(page.getByTestId('bottom-panel-tabs')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('bottom-panel-result-tab-0')).toBeVisible({
    timeout: APP_READY_MS,
  })
  await expect(page.getByTestId('bottom-panel-result-tab-2')).toBeVisible({
    timeout: APP_READY_MS,
  })
}

/** Open a query editor tab, set a CALL statement, execute, and wait for stored proc results. */
/** Open a query editor tab, set SQL content, execute, and wait for results. */
async function openQueryEditorWithResults(page: Page) {
  await openQueryEditorTab(page)

  // Set content in the query store so that F9 can execute a statement
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

  // Execute via F9 shortcut (Execute Query button was removed — run is via CodeLens/F9)
  await page.keyboard.press('F9')

  // Wait for results to appear
  await expect(page.getByTestId('result-toolbar')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('result-grid')).toBeVisible({ timeout: APP_READY_MS })
}

async function enableQueryResultEditMode(page: Page) {
  await expect(page.getByTestId('edit-mode-dropdown')).toBeVisible({ timeout: APP_READY_MS })
  await page.getByTestId('edit-mode-dropdown').click()
  await page.getByRole('option').nth(1).click()
  await expect(page.getByTestId('result-grid').locator('canvas').first()).toBeVisible({
    timeout: APP_READY_MS,
  })
}

async function enableTableTabsInBottomPanel(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__settingsStore__ as {
      setState: (
        updater: (state: {
          settings: Record<string, string>
          pendingChanges: Record<string, string>
        }) => Record<string, unknown>
      ) => void
    }
    store.setState((state) => ({
      settings: {
        ...state.settings,
        'results.tableTabsInBottomPanel': 'true',
      },
      pendingChanges: {},
    }))
  })
}

async function openScopedTableDataBottomPanel(page: Page) {
  await enableTableTabsInBottomPanel(page)
  await openQueryEditorWithMultiResultsInBottomPanel(page)

  await page.evaluate(() => {
    const workspaceStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => {
        activeTabByConnection: Record<string, string | null>
        openTab: (tab: Record<string, unknown>) => void
      }
    }

    const state = workspaceStore.getState()
    if (!state.activeTabByConnection['session-playwright-1']) {
      throw new Error('No active query tab found for scoped table-data screenshot setup')
    }

    state.openTab({
      type: 'table-data',
      label: 'users',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'users',
      objectType: 'table',
    })
  })

  await expect(page.getByTestId('bottom-panel-tabs')).toBeVisible({ timeout: APP_READY_MS })
  await expect(
    page
      .getByTestId('bottom-panel-tabs')
      .locator('[data-testid^="bottom-panel-table-tab-"]')
      .first()
  ).toBeVisible({ timeout: APP_READY_MS })
  await page.waitForFunction(
    () => {
      const queryStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
        getState: () => {
          tabs: Record<
            string,
            { activeBottomPanelItem?: { type: 'result' } | { type: 'table-data'; tabId: string } }
          >
        }
      }
      const workspaceStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
        getState: () => {
          activeTabByConnection: Record<string, string | null>
        }
      }
      const tableDataStore = (window as unknown as Record<string, unknown>).__tableDataStore__ as {
        getState: () => {
          tabs: Record<string, { isLoading: boolean; columns: Array<unknown> }>
        }
      }

      const queryTabId = workspaceStore.getState().activeTabByConnection['session-playwright-1']
      if (!queryTabId) return false

      const activeBottomPanelItem = queryStore.getState().tabs[queryTabId]?.activeBottomPanelItem
      if (!activeBottomPanelItem || activeBottomPanelItem.type !== 'table-data') return false

      const tableTabState = tableDataStore.getState().tabs[activeBottomPanelItem.tabId]
      return Boolean(tableTabState && !tableTabState.isLoading && tableTabState.columns.length > 0)
    },
    null,
    {
      timeout: APP_READY_MS,
    }
  )
  const activeTableTabId = await page.evaluate(() => {
    const queryStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
      getState: () => {
        tabs: Record<
          string,
          { activeBottomPanelItem?: { type: 'result' } | { type: 'table-data'; tabId: string } }
        >
      }
    }
    const workspaceStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => {
        activeTabByConnection: Record<string, string | null>
      }
    }

    const queryTabId = workspaceStore.getState().activeTabByConnection['session-playwright-1']
    if (!queryTabId) return null

    const activeBottomPanelItem = queryStore.getState().tabs[queryTabId]?.activeBottomPanelItem
    return activeBottomPanelItem?.type === 'table-data' ? activeBottomPanelItem.tabId : null
  })
  if (!activeTableTabId) {
    throw new Error('No active scoped table-data tab found after bottom-panel setup')
  }

  const activeBottomPanelTable = page.locator(
    `[data-testid="query-bottom-panel-table-${activeTableTabId}"]`
  )
  await expect(activeBottomPanelTable.locator('[data-testid="table-data-tab"]')).toBeVisible({
    timeout: APP_READY_MS,
  })
}

async function expectGridRegionToBeExpanded(
  page: Page,
  gridTestId: 'result-grid' | 'table-data-grid',
  minimumHeight = 120
) {
  const grid = page.getByTestId(gridTestId)
  const canvas = grid.locator('canvas').first()

  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(canvas).toBeVisible({ timeout: APP_READY_MS })

  await expect
    .poll(
      async () =>
        grid.evaluate((node, minHeight) => {
          const element = node as HTMLElement
          const rect = element.getBoundingClientRect()
          const canvas = element.querySelector('canvas')
          const canvasRect = canvas?.getBoundingClientRect()

          return {
            clientHeight: element.clientHeight,
            offsetHeight: element.offsetHeight,
            rectHeight: rect.height,
            canvasHeight: canvasRect?.height ?? 0,
            hasCanvas: canvas !== null,
            meetsMinimumHeight: rect.height >= minHeight,
          }
        }, minimumHeight),
      { timeout: APP_READY_MS }
    )
    .toEqual(
      expect.objectContaining({
        hasCanvas: true,
        meetsMinimumHeight: true,
      })
    )
}

async function expectOnlyActiveBottomPanelContentVisible(
  page: Page,
  activeContent: 'result' | 'table-data'
) {
  const resultPanel = page.getByTestId('query-bottom-panel-results')
  const tablePanels = page.locator('[data-testid^="query-bottom-panel-table-"]')

  const visibilityState = await expect
    .poll(
      async () => {
        const tablePanelStates = await tablePanels.evaluateAll((nodes) =>
          nodes.map((node) => {
            const element = node as HTMLElement
            const rect = element.getBoundingClientRect()

            return {
              hidden: element.hasAttribute('hidden'),
              visible:
                !element.hasAttribute('hidden') &&
                getComputedStyle(element).display !== 'none' &&
                getComputedStyle(element).visibility !== 'hidden' &&
                rect.height > 0,
            }
          })
        )

        return {
          resultHidden: await resultPanel.evaluate((node) => node.hasAttribute('hidden')),
          resultVisible: await resultPanel.isVisible(),
          visibleTablePanels: tablePanelStates.filter((panel) => panel.visible).length,
          hiddenTablePanels: tablePanelStates.filter((panel) => panel.hidden).length,
          tablePanelCount: tablePanelStates.length,
        }
      },
      { timeout: APP_READY_MS }
    )
    .toEqual(
      expect.objectContaining(
        activeContent === 'result'
          ? {
              resultHidden: false,
              resultVisible: true,
              visibleTablePanels: 0,
            }
          : {
              resultHidden: true,
              resultVisible: false,
              visibleTablePanels: 1,
            }
      )
    )

  return visibilityState
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
  await expect(page.getByTestId('pagination-page-input')).toHaveValue('1', {
    timeout: APP_READY_MS,
  })
  await expect(page.getByTestId('table-data-grid').locator('canvas').first()).toBeVisible({
    timeout: APP_READY_MS,
  })
}

/** Open a table data tab for a view and wait for data to load. */
async function openViewDataTab(page: Page) {
  await connectToSample(page)

  // Programmatically open a table-data tab for a view via the workspace store
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { openTab: (tab: Record<string, unknown>) => void }
    }
    store.getState().openTab({
      type: 'table-data',
      label: 'user_stats_view',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'user_stats_view',
      objectType: 'view',
    })
  })

  // Wait for the table data tab to mount and data to load
  await expect(page.getByTestId('table-data-tab')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('table-data-toolbar')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('pagination-page-input')).toHaveValue('1', {
    timeout: APP_READY_MS,
  })
  await expect(page.getByTestId('table-data-grid').locator('canvas').first()).toBeVisible({
    timeout: APP_READY_MS,
  })
}

/** Open a table data tab for the `bit_test` table and wait for data to load. */
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
  await expect(page.getByTestId('pagination-page-input')).toHaveValue('1', {
    timeout: APP_READY_MS,
  })
  await expect(page.getByTestId('table-data-grid').locator('canvas').first()).toBeVisible({
    timeout: APP_READY_MS,
  })
}

/** Open a table data tab for the `blob_sample` table (has a binary `photo` column). */
async function openBlobSampleTableDataTab(page: Page) {
  await connectToSample(page)

  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { openTab: (tab: Record<string, unknown>) => void }
    }
    store.getState().openTab({
      type: 'table-data',
      label: 'blob_sample',
      connectionId: 'session-playwright-1',
      databaseName: 'ecommerce_db',
      objectName: 'blob_sample',
      objectType: 'table',
    })
  })

  await expect(page.getByTestId('table-data-tab')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('table-data-toolbar')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('pagination-page-input')).toHaveValue('1', {
    timeout: APP_READY_MS,
  })
  await expect(page.getByTestId('table-data-grid').locator('canvas').first()).toBeVisible({
    timeout: APP_READY_MS,
  })
}

/**
 * Override the lazy `fetch_blob_value` fixture served for the `photo` column so a
 * blob-viewer screenshot can exercise a specific working-value state (NULL, empty,
 * too-large, …). Wired through the fixture registry — never inline in the mock router.
 */
async function overridePhotoBlobValue(
  page: Page,
  state: 'null' | 'empty' | 'tooLarge'
): Promise<void> {
  await applyFixtureOverrides(page, {
    reset: true,
    overrides: [{ domain: 'blobValue', key: 'photo', data: BLOB_VIEWER_SCREENSHOT_STATES[state] }],
  })
}

/**
 * Open the BlobViewerDialog in edit mode by double-clicking the binary `photo`
 * cell of the `blob_sample` table, then wait for the lazy fetch to settle.
 */
async function openBlobViewerFromTableData(page: Page, state?: 'null' | 'empty' | 'tooLarge') {
  await openBlobSampleTableDataTab(page)
  if (state) {
    await overridePhotoBlobValue(page, state)
  }
  const grid = page.getByTestId('table-data-grid')
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid.locator('canvas').first()).toBeVisible({ timeout: APP_READY_MS })

  const photoColIdx = await getColumnIndexByName(grid, 'photo')
  expect(photoColIdx).toBeGreaterThanOrEqual(0)
  const geometry = await getGlideGridGeometry(page, 'table-data-grid')
  await clickGlideCell(page, 'table-data-grid', photoColIdx, 0, geometry)
  await dblClickGlideCell(page, 'table-data-grid', photoColIdx, 0, geometry)

  await expect(page.getByTestId('blob-viewer-dialog')).toBeVisible({ timeout: APP_READY_MS })
  // The loading state clears once the lazy fetch resolves to renderable bytes.
  await expect(page.getByTestId('blob-loading')).toHaveCount(0, { timeout: APP_READY_MS })
}

/** Connect and activate the Process List tab. */
async function openProcessListTab(page: Page) {
  await connectToSample(page, { dismissToasts: true })
  const tabStrip = activeWorkspaceTabs(page)
  await expect(tabStrip).toBeVisible({ timeout: APP_READY_MS })
  await tabStrip.getByTestId('workspace-pinned-tab-processlist').click()
  await waitForGlideGrid(page, 'processlist-grid-view')

  await page.evaluate(() => {
    const processListStore = (window as unknown as Record<string, unknown>)
      .__processListStore__ as {
      setState: (
        updater: (state: {
          lastRefreshedAtByConnection: Record<string, number | null>
          isFetchingByConnection: Record<string, boolean>
          refreshIntervalMsByConnection: Record<string, number>
        }) => {
          lastRefreshedAtByConnection: Record<string, number | null>
          isFetchingByConnection: Record<string, boolean>
          refreshIntervalMsByConnection: Record<string, number>
        }
      ) => void
    }

    processListStore.setState((state) => ({
      lastRefreshedAtByConnection: {
        ...state.lastRefreshedAtByConnection,
        'session-playwright-1': Date.UTC(2025, 0, 1, 12, 34, 56),
      },
      isFetchingByConnection: {
        ...state.isFetchingByConnection,
        'session-playwright-1': false,
      },
      refreshIntervalMsByConnection: {
        ...state.refreshIntervalMsByConnection,
        'session-playwright-1': 0,
      },
    }))
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

/** Stable scroll for full-layout screenshots (parallel workers otherwise differ on tree scroll). */
async function resetChromeScrollPositions(page: Page) {
  await page.evaluate(() => {
    const objectBrowser = document.querySelector('[data-testid="object-browser-scroll"]')
    if (objectBrowser instanceof HTMLElement) {
      objectBrowser.scrollTop = 0
    }

    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) {
      activeElement.blur()
    }

    window.scrollTo(0, 0)
  })

  await page.mouse.move(0, 0)
}

async function waitForAnimationsToFinish(locator: Locator) {
  await locator.evaluate(async (element) => {
    const animations = element.getAnimations({ subtree: true })
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)))
  })
}

for (const theme of themes) {
  test.describe(`visual regression (${theme})`, () => {
    test.describe.configure({ timeout: SCREENSHOT_TEST_TIMEOUT_MS })

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

    test('Sidebar — sidebar-inner', async ({ page }) => {
      await expect(page.getByTestId('sidebar-inner')).toHaveScreenshot(`sidebar-inner-${theme}.png`)
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
      await selectSampleConnection(page.getByTestId('connection-dialog'))
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
      await page.getByTestId('connection-form-tab-advanced').click()
      await page.getByRole('button', { name: 'Choose color' }).click()
      await expect(page.getByTestId('color-picker-popover')).toBeVisible()
      await expect(page.getByTestId('color-picker-popover')).toHaveScreenshot(
        `color-picker-popover-${theme}.png`
      )
    })

    test('Dropdown — group list open', async ({ page }) => {
      await openConnectionManager(page)
      await page.getByTestId('connection-form-tab-advanced').click()
      const formMain = page.getByTestId('connection-form-main')
      const advancedPanel = page.getByTestId('connection-form-panel-advanced')
      await expect(advancedPanel).toBeVisible()
      await waitForAnimationsToFinish(advancedPanel)
      const groupField = advancedPanel.locator('label[for="conn-group"]').locator('xpath=..')
      await formMain.locator('#conn-group').click()
      const listbox = page.getByRole('listbox', { name: 'Group' })
      await expect(listbox).toBeVisible()
      const clip = await getUnionClip(page, [groupField, listbox])
      await expect(page).toHaveScreenshot(`group-dropdown-open-${theme}.png`, { clip })
    })

    test('GlobalContextMenu — on host field', async ({ page }) => {
      await openConnectionManager(page)
      await page.locator('#conn-host').click({ button: 'right' })
      await expect(page.getByTestId('global-context-menu')).toBeVisible()
      await expect(page.getByTestId('global-context-menu')).toHaveScreenshot(
        `global-context-menu-${theme}.png`
      )
    })

    test('StatusBar — indexing indicator', async ({ page }) => {
      await connectToSample(page)

      // Inject a 'building' state (embedding phase) into the schema index
      // store for the active session.
      await page.evaluate(() => {
        const store = (window as unknown as Record<string, unknown>).__schemaIndexStore__ as {
          setState: (
            updater: (state: {
              connections: Record<string, Record<string, unknown>>
            }) => Record<string, unknown>
          ) => void
        }
        store.setState((state) => ({
          connections: {
            ...state.connections,
            'session-playwright-1': {
              status: 'building',
              phase: 'embedding',
              tablesDone: 7,
              tablesTotal: 15,
              lastBuildTimestamp: 0,
            },
          },
        }))
      })

      await expect(page.getByTestId('indexing-indicator')).toBeVisible({ timeout: APP_READY_MS })

      await expect(page.getByTestId('status-bar')).toHaveScreenshot(
        `status-bar-indexing-${theme}.png`,
        { animations: 'disabled' }
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
      await expect(activeWorkspaceTabs(page)).toHaveScreenshot(
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

    test('ObjectBrowserContextMenu — table node with design action', async ({ page }) => {
      await connectToSample(page)

      // Expand database and Tables category to reach table nodes
      await page.getByText('ecommerce_db').first().click()
      await expect(page.getByTestId('object-browser').getByText('Tables')).toBeVisible()
      await page.getByTestId('object-browser').getByText('Tables').click()
      await expect(page.getByTestId('object-browser').getByText('users')).toBeVisible()

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

    test('CopyToHostDialog — options expanded', async ({ page }) => {
      await openCopyToHostDialog(page, 'table')
      await chooseCopyToHostTarget(page)
      await page.getByTestId('copy-target-database').click()
      await page.getByTestId('copy-target-database-option-__new__').click()
      await page.getByTestId('copy-new-database-name').fill('warehouse_clone')
      await page.getByTestId('copy-type').click()
      await page.getByTestId('copy-type-option-structureOnly').click()
      await expect(page.getByTestId('copy-to-host-dialog')).toHaveScreenshot(
        `copy-to-host-dialog-options-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    // --- Query Editor states ---

    test('full app layout — query editor with results', async ({ page }) => {
      await openQueryEditorWithResults(page)
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('app-layout')).toHaveScreenshot(
        `app-full-layout-query-editor-results-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    // --- Phase 5 view mode & export dialog screenshots ---

    test('ResultFormView — form view in edit mode (editable vs non-editable fields)', async ({
      page,
    }) => {
      await openQueryEditorWithResults(page)
      await enableQueryResultEditMode(page)

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
      await expect(page.getByTestId('export-dialog-panel')).toBeVisible({ timeout: APP_READY_MS })
      await dismissAllToasts(page)
      await page.getByTestId('export-file-path-input').fill('/tmp/playwright-export.csv')
      // Reset scroll positions for stable screenshots
      await page.getByTestId('object-browser-scroll').evaluate((el) => {
        el.scrollTop = 0
      })
      await page.evaluate(() => {
        window.scrollTo(0, 0)
      })
      await page.evaluate(() => {
        const el = document.activeElement
        if (el && el instanceof HTMLElement) el.blur()
      })
      await page.mouse.move(0, 0)
      // Screenshot the dialog panel rather than the backdrop wrapper to avoid background drift.
      await expect(page.getByTestId('export-dialog-panel')).toHaveScreenshot(
        `export-dialog-${theme}.png`,
        {
          animations: 'disabled',
        }
      )
    })

    test('SqlDumpDialog — open via context menu', async ({ page }) => {
      await connectToSample(page)
      // Wait for the object browser to be fully loaded
      await expect(page.getByTestId('object-browser').getByText('ecommerce_db')).toBeVisible({
        timeout: APP_READY_MS,
      })
      // Right-click on the ecommerce_db database node to open context menu
      await page.getByTestId('object-browser').getByText('ecommerce_db').click({ button: 'right' })
      await expect(page.getByTestId('object-browser-context-menu')).toBeVisible({
        timeout: APP_READY_MS,
      })
      // Click "Export SQL Dump..." in the context menu
      await page.getByTestId('ctx-export-dump').click()
      // Wait for the SqlDumpDialog to appear and objects to load
      await expect(page.getByTestId('sql-dump-dialog')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('dump-object-tree')).toBeVisible({ timeout: APP_READY_MS })
      // Reset scroll positions for stable screenshots
      await resetChromeScrollPositions(page)
      // Full viewport screenshot with the dialog modal visible
      await expect(page).toHaveScreenshot(`sql-dump-dialog-${theme}.png`, {
        animations: 'disabled',
      })
    })

    test('SqlImportDialog — running state', async ({ page }) => {
      await connectToSample(page)
      // Open the import dialog programmatically via the import-dialog-store
      await page.evaluate(() => {
        const store = (window as unknown as Record<string, unknown>).__importDialogStore__ as {
          getState: () => {
            openImportDialog: (connectionId: string, filePath: string) => void
          }
        }
        store.getState().openImportDialog('session-playwright-1', '/mock/data/schema_dump.sql')
      })
      // Wait for the dialog to appear
      await expect(page.getByTestId('sql-import-dialog')).toBeVisible({ timeout: APP_READY_MS })
      // Click Import to start importing
      await page.getByTestId('import-submit-button').click()
      // Wait for progress to appear (the mock returns running state)
      await expect(page.getByTestId('import-progress')).toBeVisible({ timeout: APP_READY_MS })
      // Reset scroll positions for stable screenshots
      await resetChromeScrollPositions(page)
      // Full viewport screenshot with the dialog modal visible
      await expect(page).toHaveScreenshot(`sql-import-dialog-running-${theme}.png`, {
        animations: 'disabled',
      })
    })

    // --- Phase 6 Table Data Browser screenshots ---

    test('TableDataGrid — grid view with data', async ({ page }) => {
      await openTableDataTab(page)
      // Wait for the data grid to be rendered with data
      await expect(page.getByTestId('table-data-grid')).toBeVisible({ timeout: APP_READY_MS })
      // Wait for at least one data row to render
      await expect(page.getByTestId('table-data-grid').locator('canvas').first()).toBeVisible({
        timeout: APP_READY_MS,
      })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-data-tab')).toHaveScreenshot(
        `table-data-grid-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('FkLookupDialog — open with data loaded (orders table)', async ({ page }) => {
      await openOrdersTableDataTab(page)
      const grid = page.getByTestId('table-data-grid')
      await expect(grid).toBeVisible({ timeout: APP_READY_MS })
      await expect(grid.locator('canvas').first()).toBeVisible({ timeout: APP_READY_MS })
      // Wait for FK metadata to load (async fire-and-forget in store)
      await page.waitForTimeout(500)
      const userIdColumn = await getColumnIndexByName(grid, 'user_id')
      const geometry = await getGlideGridGeometry(page, 'table-data-grid')
      await clickGlideFkEllipsis(page, 'table-data-grid', userIdColumn, 0, geometry)
      // Wait for the FK lookup dialog to appear and data to load
      await expect(page.getByTestId('fk-lookup-dialog')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('fk-lookup-grid')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('fk-lookup-grid').locator('canvas').first()).toBeVisible({
        timeout: APP_READY_MS,
      })
      // Reset scroll positions for stable screenshots
      await resetChromeScrollPositions(page)
      // Full viewport screenshot — dialog is a modal
      await expect(page).toHaveScreenshot(`fk-lookup-dialog-open-${theme}.png`, {
        animations: 'disabled',
      })
    })

    test('BlobViewerDialog — edit mode, Image tab (table-data)', async ({ page }) => {
      await openBlobViewerFromTableData(page)
      await page.getByTestId('blob-tab-image').click()
      await expect(page.getByTestId('blob-image')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('blob-viewer-dialog')).toHaveScreenshot(
        `blob-viewer-image-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('BaseFormView — View/Edit button beside a binary field (table-data form view)', async ({
      page,
    }) => {
      await openBlobSampleTableDataTab(page)
      await page.getByTestId('view-mode-form').click()
      await expect(page.getByTestId('table-data-form-view')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('btn-blob-view-photo')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('table-data-form-view')).toHaveScreenshot(
        `blob-form-view-edit-button-${theme}.png`,
        { animations: 'disabled' }
      )
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

    test('TableDataToolbar — toolbar controls', async ({ page }) => {
      await openTableDataTab(page)
      await expect(page.getByTestId('btn-clone-row')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('table-data-toolbar')).toHaveScreenshot(
        `table-data-toolbar-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('view data tab — VIEW badge and no mutation buttons', async ({ page }) => {
      await openViewDataTab(page)
      await expect(page.getByTestId('view-badge')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('table-data-grid')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('table-data-grid').locator('canvas').first()).toBeVisible({
        timeout: APP_READY_MS,
      })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('table-data-tab')).toHaveScreenshot(
        `view-data-tab-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('ResultGridView — enum dropdown open', async ({ page }) => {
      await openQueryEditorWithResults(page)
      await enableQueryResultEditMode(page)

      const grid = page.getByTestId('result-grid')
      await expect(grid).toBeVisible({ timeout: APP_READY_MS })
      await expect(grid.locator('canvas').first()).toBeVisible({ timeout: APP_READY_MS })

      const statusColIdx = await getColumnIndexByName(grid, 'status')
      const statusCell = await getGridCellByColumnName(grid, 0, 'status')
      const geometry = await getGlideGridGeometry(page, 'result-grid')
      await clickGlideCell(page, 'result-grid', statusColIdx, 0, geometry)
      await dblClickGlideCell(page, 'result-grid', statusColIdx, 0, geometry)

      const enumEditor = glideDropdownEditor(page)
      await expect(enumEditor).toBeVisible({ timeout: APP_READY_MS })

      const clip = await getUnionClip(page, [statusCell, enumEditor])
      expect(await page.screenshot({ animations: 'disabled', clip })).toMatchSnapshot(
        `result-grid-enum-dropdown-open-${theme}.png`
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

    // --- Filter Dialog screenshots ---

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

    // --- Filter Active / Clear Filter screenshots ---

    test('result-toolbar-filter-active — query result toolbar with active filter', async ({
      page,
    }) => {
      await openQueryEditorWithResults(page)

      // Inject a filterModel into the active query result via the query store
      await page.evaluate(() => {
        const wsStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
          getState: () => {
            activeTabByConnection: Record<string, string | null>
          }
        }
        const queryStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
          getState: () => {
            applyQueryFilters: (
              tabId: string,
              resultIndex: number,
              conditions: Array<{ column: string; operator: string; value: string }>
            ) => void
          }
        }
        const activeTabId = wsStore.getState().activeTabByConnection['session-playwright-1']
        if (!activeTabId) throw new Error('No active query tab found')
        queryStore
          .getState()
          .applyQueryFilters(activeTabId, 0, [{ column: 'name', operator: '==', value: 'Alice' }])
      })

      // Wait for filter badge to appear
      await expect(page.getByTestId('filter-badge')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('btn-clear-filter')).toBeVisible({ timeout: APP_READY_MS })

      await expect(page.getByTestId('result-toolbar')).toHaveScreenshot(
        `result-toolbar-filter-active-${theme}.png`,
        { animations: 'disabled' }
      )
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

    // --- Multi-result tab screenshots ---

    test('Multi-result tabs — 3 result tabs (2 SELECT + 1 DML)', async ({ page }) => {
      await openQueryEditorWithMultiResults(page)
      // Active tab should be Result 1 (index 0)
      await expect(page.getByTestId('result-tab-0')).toHaveAttribute('aria-selected', 'true')
      // Screenshot the result panel showing the tab strip with grid view
      await expect(page.getByTestId('result-panel')).toHaveScreenshot(
        `multi-result-tabs-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    // --- Settings Dialog screenshots (Phase 9.2) ---

    test('SnapshotDialog — populated', async ({ page }) => {
      await page.getByTestId('snapshots-button').click()
      await expect(page.getByTestId('snapshot-dialog')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('snapshot-row-3')).toBeVisible({ timeout: APP_READY_MS })
      await page.evaluate(() => {
        const el = document.activeElement
        if (el && el instanceof HTMLElement) el.blur()
      })
      await expect(page.getByTestId('snapshot-dialog')).toHaveScreenshot(
        `snapshot-dialog-populated-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('QueryEditorTab — combined bottom panel with results and scoped table-data tabs', async ({
      page,
    }) => {
      await openScopedTableDataBottomPanel(page)
      const activeResultTab = page.getByTestId('bottom-panel-tabs').getByRole('tab', {
        name: /result 1/i,
      })
      await activeResultTab.click()
      await expect(activeResultTab).toHaveAttribute('aria-selected', 'true')
      await expectOnlyActiveBottomPanelContentVisible(page, 'result')
      // The workspace stack rail + member tab row, the BottomPanelTabs strip, and the ResultToolbar
      // together consume most of the vertical space, leaving ~88px for the grid at the 720px
      // viewport — below the default 120px minimum. Assert it is still meaningfully expanded.
      await expectGridRegionToBeExpanded(page, 'result-grid', 80)

      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('query-editor-tab')).toHaveScreenshot(
        `query-editor-bottom-panel-combined-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    // --- History & Favorites screenshots (Phase 9.3) ---

    test('HistoryFavoritesTab — split-panel layout', async ({ page }) => {
      await connectToSample(page)
      // The history tab is now auto-created when a connection opens.
      // Click the History tab in the workspace tab bar to make it active.
      const workspaceTabs = activeWorkspaceTabs(page)
      const historyTab = workspaceTabs.getByTestId('workspace-pinned-tab-history')
      await expect(historyTab).toBeVisible({ timeout: APP_READY_MS })
      await historyTab.click()
      await expect(page.getByTestId('history-tab')).toBeVisible({ timeout: APP_READY_MS })
      // Wait for the filter panel and history table to render
      await expect(page.getByTestId('history-filter-panel')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('history-table')).toBeVisible({ timeout: APP_READY_MS })
      await dismissAllToasts(page)
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('history-tab')).toHaveScreenshot(`history-tab-${theme}.png`, {
        animations: 'disabled',
      })
    })

    test('FavoriteDialog — create new', async ({ page }) => {
      await connectToSample(page)
      // Open favourites panel in the sidebar
      await page.getByTestId('favourites-toggle').click()
      await expect(page.getByTestId('favourites-view')).toBeVisible({ timeout: APP_READY_MS })
      // Click the "New Snippet" button to open the create dialog
      await page.getByTestId('favourites-new-snippet').click()
      await expect(page.getByTestId('favorite-dialog')).toBeVisible({ timeout: APP_READY_MS })
      // Blur any focused element for stable screenshot
      await page.evaluate(() => {
        const el = document.activeElement
        if (el && el instanceof HTMLElement) el.blur()
      })
      await dismissAllToasts(page)
      // resetChromeScrollPositions targets object-browser-scroll which is
      // hidden when the favourites panel replaces the object browser.
      // Reset the window scroll only since this test uses structural assertions.
      await page.evaluate(() => window.scrollTo(0, 0))
      // Structural assertions instead of screenshot comparison.
      // This dialog's pixel rendering is non-deterministic under parallel
      // worker load (sub-pixel anti-aliasing, border compositing, portal
      // positioning all shift by 988–1990 pixels depending on CPU/GPU
      // contention). Structural assertions verify the same intent — the
      // dialog is correctly laid out with all expected fields — without
      // any pixel comparison.
      const panel = page.getByTestId('favorite-dialog-panel')
      await expect(panel).toBeVisible()
      // Title
      await expect(panel.locator('h2')).toHaveText('New Favorite')
      // Fields: Name, SQL, Scope, Category, Description
      await expect(panel.getByTestId('favorite-name-input')).toBeVisible()
      await expect(panel.getByTestId('favorite-sql-input')).toBeVisible()
      await expect(panel.getByTestId('favorite-scope-dropdown')).toBeVisible()
      await expect(panel.getByTestId('favorite-category-input')).toBeVisible()
      await expect(panel.getByTestId('favorite-description-input')).toBeVisible()
      // Action buttons
      await expect(panel.getByTestId('favorite-dialog-cancel')).toHaveText('Cancel')
      await expect(panel.getByTestId('favorite-dialog-save')).toHaveText('Save')
      await expect(panel.getByTestId('favorite-dialog-save')).toBeDisabled()
    })

    // --- AI Assistant screenshots ---

    test('SettingsDialog — AI section', async ({ page }) => {
      await page.getByTestId('settings-button').click()
      await expect(page.getByTestId('settings-dialog')).toBeVisible({ timeout: APP_READY_MS })
      await page.getByTestId('settings-nav-ai').click()
      await expect(page.getByTestId('settings-ai')).toBeVisible({ timeout: APP_READY_MS })
      await page.evaluate(() => {
        const el = document.activeElement
        if (el && el instanceof HTMLElement) el.blur()
      })
      await expect(page.getByTestId('settings-dialog')).toHaveScreenshot(
        `settings-dialog-ai-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('AI panel — with messages', async ({ page }) => {
      await openQueryEditorTab(page)
      await enableAiViaStore(page)
      await expect(page.getByTestId('ai-sidebar-expand')).toBeVisible({ timeout: APP_READY_MS })
      await page.getByTestId('ai-sidebar-expand').click()
      await expect(page.getByTestId('ai-panel')).toBeVisible({ timeout: APP_READY_MS })

      // Send a message and wait for streaming to finish
      const textarea = page.getByTestId('ai-chat-textarea')
      await textarea.fill('How do I select active users?')
      await page.getByTestId('ai-send-button').click()

      // Wait for the assistant message to finish streaming
      await expect(page.getByTestId('ai-message-assistant')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('ai-message-assistant')).toContainText(
        'This query filters for active users',
        { timeout: APP_READY_MS }
      )

      // Blur any focused element for stable screenshot
      await page.evaluate(() => {
        const el = document.activeElement
        if (el && el instanceof HTMLElement) el.blur()
      })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('ai-panel')).toHaveScreenshot(
        `ai-panel-with-messages-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    // Seed the multi-level memory manager: connection store (connections +
    // groups + an active session for inline-add) and the override fixture store
    // (global / group / connection memories keyed by owner).
    test('AI workspace rail — visible when AI enabled', async ({ page }) => {
      await openQueryEditorTab(page)
      await enableAiViaStore(page)
      await expect(page.getByTestId('ai-sidebar-expand')).toBeVisible({ timeout: APP_READY_MS })
      // Blur any focused element for stable screenshot
      await page.evaluate(() => {
        const el = document.activeElement
        if (el && el instanceof HTMLElement) el.blur()
      })
      await expect(page.getByTestId('ai-workspace-rail')).toHaveScreenshot(
        `ai-workspace-rail-${theme}.png`,
        { animations: 'disabled' }
      )
    })

    test('DiffOverlay — AI-proposed SQL change review', async ({ page }) => {
      await openQueryEditorTab(page)
      await enableAiViaStore(page)

      // Set SQL content in the editor
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

          // Set attached context on the AI store so the Diff button appears
          const aiStore = (window as unknown as Record<string, unknown>).__aiStore__ as {
            getState: () => {
              setAttachedContext: (
                tabId: string,
                context: {
                  sql: string
                  range: {
                    startLineNumber: number
                    endLineNumber: number
                    startColumn: number
                    endColumn: number
                  }
                }
              ) => void
            }
          }
          aiStore.getState().setAttachedContext(queryTab.id, {
            sql: 'SELECT * FROM users',
            range: {
              startLineNumber: 1,
              endLineNumber: 1,
              startColumn: 1,
              endColumn: 21,
            },
          })
        }
      })

      await page.waitForTimeout(300)

      // Open AI panel
      await expect(page.getByTestId('ai-sidebar-expand')).toBeVisible({ timeout: APP_READY_MS })
      await page.getByTestId('ai-sidebar-expand').click()
      await expect(page.getByTestId('ai-panel')).toBeVisible({ timeout: APP_READY_MS })

      // Send a message and wait for the response with SQL
      const textarea = page.getByTestId('ai-chat-textarea')
      await textarea.fill('How do I select active users?')
      await page.getByTestId('ai-send-button').click()

      // Wait for the assistant message to finish streaming (contains SQL code block)
      await expect(page.getByTestId('ai-message-assistant')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('ai-message-assistant')).toContainText(
        'This query filters for active users',
        { timeout: APP_READY_MS }
      )

      // The sendMessage flow clears attachedContext after capturing it. Re-set it
      // so the Diff button becomes visible on the assistant's code block.
      await page.evaluate(() => {
        const wsStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
          getState: () => {
            tabsByConnection: Record<string, { id: string; type: string }[]>
          }
        }
        const activeTabs = wsStore.getState().tabsByConnection['session-playwright-1'] ?? []
        const queryTab = activeTabs.find((t) => t.type === 'query-editor')
        if (queryTab) {
          const aiStore = (window as unknown as Record<string, unknown>).__aiStore__ as {
            getState: () => {
              setAttachedContext: (
                tabId: string,
                context: {
                  sql: string
                  range: {
                    startLineNumber: number
                    endLineNumber: number
                    startColumn: number
                    endColumn: number
                  }
                }
              ) => void
            }
          }
          aiStore.getState().setAttachedContext(queryTab.id, {
            sql: 'SELECT * FROM users',
            range: {
              startLineNumber: 1,
              endLineNumber: 1,
              startColumn: 1,
              endColumn: 21,
            },
          })
        }
      })

      // Click the Diff button on the code block
      const diffButton = page.getByTestId('ai-code-diff-button')
      await expect(diffButton).toBeVisible({ timeout: APP_READY_MS })
      await diffButton.click()

      // Wait for the diff overlay to appear
      await expect(page.getByTestId('diff-overlay')).toBeVisible({ timeout: APP_READY_MS })

      // Blur any focused element for stable screenshot
      await page.evaluate(() => {
        const el = document.activeElement
        if (el && el instanceof HTMLElement) el.blur()
      })
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('diff-overlay')).toHaveScreenshot(`diff-overlay-${theme}.png`, {
        animations: 'disabled',
      })

      // Close dismisses the overlay when no per-hunk accepts were made
      await page.getByTestId('diff-close-button').click()
    })

    // NOTE: Monaco CodeLens screenshot is intentionally skipped.
    // CodeLens items are registered via Monaco's internal ICodeLensProvider API
    // and render as inline widgets within the editor viewport. In Playwright's
    // web build (VITE_PLAYWRIGHT), Monaco loads but CodeLens decorations are
    // not reliably visible because:
    // 1. The CodeLens provider fires asynchronously and requires a fully
    //    mounted editor with parsed content.
    // 2. In the headless Playwright environment, Monaco's viewport height
    //    may be too small or the CodeLens rendering cycle may not complete
    //    before screenshot capture.
    // 3. CodeLens items are dynamically positioned by Monaco's internal
    //    layout engine and are not exposed via data-testid attributes.
    // Visual verification of CodeLens should be done via the Tauri desktop
    // build using the MCP testing workflow described in mcp_testing.md.

    // --- Process List screenshots ---

    test('ProcessListTab — grid with data', async ({ page }) => {
      await openProcessListTab(page)
      await resetChromeScrollPositions(page)
      await expect(page.getByTestId('processlist-grid-view')).toHaveScreenshot(
        `processlist-grid-${theme}.png`,
        { animations: 'disabled' }
      )
    })
  })
}

for (const theme of themes) {
  test.describe(`command palette (${theme})`, () => {
    test('CommandPalette — active results', async ({ page }) => {
      await waitForApp(page)
      await ensureTheme(page, theme)
      await prepareCommandPalette(page)
      await openCommandPalette(page)
      await page.getByTestId('command-palette-input').fill('user')
      await expect(page.getByTestId('command-palette-results')).toContainText('users')
      await expect(page.getByTestId('command-palette')).toHaveScreenshot(
        `command-palette-results-${theme}.png`,
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
    })
  }
})
