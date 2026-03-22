import { test, expect, type Page } from '@playwright/test'

const themes = ['light', 'dark'] as const

/** Dev server + async `main.tsx` (dynamic imports, IPC mock, theme) under many parallel workers can exceed the default 5s expect timeout. */
const APP_READY_MS = 60_000

async function waitForApp(page: Page) {
  await page.goto('/', { waitUntil: 'load', timeout: APP_READY_MS })
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
  for (let i = 0; i < 8; i++) {
    const btn = page.getByTestId('toast-dismiss').first()
    if (!(await btn.isVisible().catch(() => false))) {
      break
    }
    await btn.click()
  }
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
          connectionId: 'conn-playwright-1',
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
  })
}
