import { test, expect, type Page } from '@playwright/test'
import { APP_READY_MS, waitForApp } from './helpers'

// ---------------------------------------------------------------------------
// Shared helpers — same patterns as other E2E specs
// ---------------------------------------------------------------------------

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
  await expect(page.getByTestId('object-browser')).toBeVisible()
  await expect(page.getByTestId('object-browser').getByText('ecommerce_db')).toBeVisible()
  await dismissAllToasts(page)
}

/**
 * Expand the object browser tree: ecommerce_db → given category.
 * Categories: Tables, Views, Procedures, Functions, Triggers, Events
 */
async function expandCategory(page: Page, categoryLabel: string) {
  // Expand database
  await page.getByText('ecommerce_db').first().click()
  await expect(page.getByTestId('object-browser').getByText('Tables')).toBeVisible({
    timeout: APP_READY_MS,
  })

  // Expand category
  await page.getByTestId('object-browser').getByText(categoryLabel, { exact: true }).click()
  await page.waitForTimeout(300) // Let tree expand settle
}

/**
 * Open an object-editor tab programmatically via the workspace store.
 */
async function openObjectEditorTab(
  page: Page,
  opts: {
    objectName: string
    objectType: string
    mode: 'create' | 'alter'
    databaseName?: string
  }
) {
  const { objectName, objectType, mode, databaseName = 'ecommerce_db' } = opts
  const typeLabels: Record<string, string> = {
    procedure: 'Stored Procedure',
    function: 'Function',
    trigger: 'Trigger',
    event: 'Event',
    view: 'View',
  }
  const typeLabel = typeLabels[objectType] ?? objectType
  const label = mode === 'create' ? `New ${typeLabel}` : `${typeLabel}: ${objectName}`

  await page.evaluate(
    ({ objectName, objectType, mode, databaseName, label }) => {
      const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
        getState: () => { openTab: (tab: Record<string, unknown>) => void }
      }
      store.getState().openTab({
        type: 'object-editor',
        label,
        connectionId: 'session-playwright-1',
        databaseName,
        objectName,
        objectType,
        mode,
      })
    },
    { objectName, objectType, mode, databaseName, label }
  )

  await expect(page.getByTestId('object-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Object Editor', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page)
  })

  test('alter procedure — right-click procedure node opens object editor with DDL', async ({
    page,
  }) => {
    await connectToSample(page)
    await expandCategory(page, 'Procedures')

    // The mock returns 'sp_get_orders' as the procedure name
    const procNode = page.getByText('sp_get_orders')
    await expect(procNode).toBeVisible({ timeout: APP_READY_MS })

    // Right-click to open context menu
    await procNode.click({ button: 'right' })
    await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

    // Click "Alter Procedure..."
    await page.getByTestId('ctx-alter-procedure').click()

    // Verify object editor tab opens
    await expect(page.getByTestId('object-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

    // Verify toolbar shows
    await expect(page.getByTestId('object-editor-toolbar')).toBeVisible()

    // Verify the editor contains DDL content (the mock returns procedure DDL)
    // The Monaco editor should contain CREATE PROCEDURE text
    const editorTab = page.getByTestId('object-editor-tab')
    await expect(editorTab).toContainText('CREATE PROCEDURE', { timeout: APP_READY_MS })
  })

  test('alter view — right-click view node opens object editor with DDL', async ({ page }) => {
    await connectToSample(page)
    await expandCategory(page, 'Views')

    // The mock returns 'user_stats_view' as the view name
    const viewNode = page.getByText('user_stats_view')
    await expect(viewNode).toBeVisible({ timeout: APP_READY_MS })

    // Right-click to open context menu
    await viewNode.click({ button: 'right' })
    await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

    // Click "Alter View..."
    await page.getByTestId('ctx-alter-view').click()

    // Verify object editor tab opens
    await expect(page.getByTestId('object-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByTestId('object-editor-toolbar')).toBeVisible()

    // Verify the editor contains DDL content
    const editorTab = page.getByTestId('object-editor-tab')
    await expect(editorTab).toContainText('CREATE', { timeout: APP_READY_MS })
  })

  test('execute procedure — right-click procedure opens query tab with CALL', async ({ page }) => {
    await connectToSample(page)
    await expandCategory(page, 'Procedures')

    const procNode = page.getByText('sp_get_orders')
    await expect(procNode).toBeVisible({ timeout: APP_READY_MS })

    // Right-click to open context menu
    await procNode.click({ button: 'right' })
    await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

    // Click "Execute"
    await page.getByTestId('ctx-execute').click()

    // Verify a query editor tab opens
    await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

    // Verify the workspace tab label contains "Execute:"
    const workspaceTabs = page.getByTestId('workspace-tabs')
    await expect(workspaceTabs).toContainText('Execute:', { timeout: APP_READY_MS })

    // Verify the query content contains CALL
    // We check via the Monaco editor wrapper which should contain the CALL template
    const queryEditorTab = page.getByTestId('query-editor-tab')
    await expect(queryEditorTab).toContainText('CALL', { timeout: APP_READY_MS })
  })

  test('execute function — right-click function opens query tab with SELECT', async ({ page }) => {
    await connectToSample(page)
    await expandCategory(page, 'Functions')

    const funcNode = page.getByText('fn_calculate_total')
    await expect(funcNode).toBeVisible({ timeout: APP_READY_MS })

    // Right-click to open context menu
    await funcNode.click({ button: 'right' })
    await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

    // Click "Execute"
    await page.getByTestId('ctx-execute').click()

    // Verify a query editor tab opens
    await expect(page.getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

    // Verify the query content contains SELECT
    const queryEditorTab = page.getByTestId('query-editor-tab')
    await expect(queryEditorTab).toContainText('SELECT', { timeout: APP_READY_MS })
  })

  test('drop procedure — confirmation dialog appears and drop succeeds', async ({ page }) => {
    await connectToSample(page)
    await expandCategory(page, 'Procedures')

    const procNode = page.getByText('sp_get_orders')
    await expect(procNode).toBeVisible({ timeout: APP_READY_MS })

    // Right-click to open context menu
    await procNode.click({ button: 'right' })
    await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

    // Click "Drop Procedure..."
    await page.getByTestId('ctx-drop-procedure').click()

    // Verify confirmation dialog appears
    await expect(page.getByTestId('confirm-dialog')).toBeVisible({ timeout: APP_READY_MS })

    // Confirm the drop
    const confirmBtn = page
      .getByTestId('confirm-dialog')
      .getByRole('button', { name: /confirm|drop|yes/i })
    await confirmBtn.click()

    // Verify dialog closes (drop_object returns undefined = success)
    await expect(page.getByTestId('confirm-dialog')).not.toBeVisible({ timeout: APP_READY_MS })

    // Dismiss success toast
    await dismissAllToasts(page)
  })

  test('dirty state — closing tab shows unsaved changes dialog', async ({ page }) => {
    await connectToSample(page)

    // Programmatically open an object-editor tab in alter mode
    await openObjectEditorTab(page, {
      objectName: 'sp_get_orders',
      objectType: 'procedure',
      mode: 'alter',
    })

    // Wait for content to load
    await expect(page.getByTestId('object-editor-toolbar')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByTestId('object-editor-tab')).toContainText('CREATE PROCEDURE', {
      timeout: APP_READY_MS,
    })

    // Modify content to make the tab dirty — set content via the object editor store
    await page.evaluate(() => {
      const wsStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
        getState: () => {
          activeTabByConnection: Record<string, string | null>
          tabsByConnection: Record<string, { id: string; type: string }[]>
        }
      }
      const activeTabs = wsStore.getState().tabsByConnection['session-playwright-1'] ?? []
      const objEditorTab = activeTabs.find((t) => t.type === 'object-editor')
      if (!objEditorTab) throw new Error('No object editor tab found')

      const objStore = (window as unknown as Record<string, unknown>).__objectEditorStore__ as {
        getState: () => { setContent: (id: string, c: string) => void }
      }
      objStore.getState().setContent(objEditorTab.id, '-- modified content')
    })

    await page.waitForTimeout(300)

    // Close the tab via the workspace store (triggers dirty guard)
    await page.evaluate(() => {
      const wsStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
        getState: () => {
          tabsByConnection: Record<string, { id: string; type: string }[]>
          closeTab: (connectionId: string, tabId: string) => void
        }
      }
      const activeTabs = wsStore.getState().tabsByConnection['session-playwright-1'] ?? []
      const objEditorTab = activeTabs.find((t) => t.type === 'object-editor')
      if (objEditorTab) {
        wsStore.getState().closeTab('session-playwright-1', objEditorTab.id)
      }
    })

    // Verify unsaved changes dialog appears
    await expect(page.getByTestId('unsaved-changes-dialog')).toBeVisible({ timeout: APP_READY_MS })
  })

  test('create procedure from category — right-click Procedures category opens editor with template', async ({
    page,
  }) => {
    await connectToSample(page)

    // Expand database to see categories
    await page.getByText('ecommerce_db').first().click()
    await expect(page.getByText('Procedures')).toBeVisible({ timeout: APP_READY_MS })

    // Right-click on "Procedures" category
    await page.getByText('Procedures', { exact: true }).click({ button: 'right' })
    await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

    // Click "Create Procedure..."
    await page.getByTestId('ctx-create-procedure').click()

    // Verify object editor tab opens in create mode
    await expect(page.getByTestId('object-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByTestId('object-editor-toolbar')).toBeVisible()

    // The toolbar should show "New Stored Procedure" (create mode)
    await expect(page.getByTestId('object-editor-toolbar')).toContainText('New', {
      timeout: APP_READY_MS,
    })

    // Editor should contain the template — CREATE PROCEDURE with placeholder
    const editorTab = page.getByTestId('object-editor-tab')
    await expect(editorTab).toContainText('CREATE PROCEDURE', { timeout: APP_READY_MS })
  })

  test('create view from database — right-click database node opens editor with template', async ({
    page,
  }) => {
    await connectToSample(page)

    // Right-click on database node
    const dbNode = page.getByText('ecommerce_db').first()
    await dbNode.click({ button: 'right' })
    await expect(page.getByTestId('object-browser-context-menu')).toBeVisible()

    // Click "Create View..."
    await page.getByTestId('ctx-create-view').click()

    // Verify object editor tab opens
    await expect(page.getByTestId('object-editor-tab')).toBeVisible({ timeout: APP_READY_MS })
    await expect(page.getByTestId('object-editor-toolbar')).toBeVisible()

    // The toolbar should show "New View" (create mode)
    await expect(page.getByTestId('object-editor-toolbar')).toContainText('New', {
      timeout: APP_READY_MS,
    })

    // Editor should contain the template
    const editorTab = page.getByTestId('object-editor-tab')
    await expect(editorTab).toContainText('CREATE VIEW', { timeout: APP_READY_MS })
  })
})
