import { expect, test, type Locator, type Page } from '@playwright/test'
import { activeWorkspaceTabMembers, APP_READY_MS, connectToSample, waitForApp } from './helpers'

const SAMPLE_SESSION_ID = 'session-playwright-1'
const MANY_TABLES = Array.from({ length: 60 }, (_, i) => `table_${String(i + 1).padStart(3, '0')}`)

/** Serve a long table list through the fixture registry so the tree scrolls. */
async function overrideTableList(page: Page, tables: string[]): Promise<void> {
  await page.evaluate((data) => {
    const registry = (window as unknown as Record<string, unknown>)
      .__PLAYWRIGHT_FIXTURE_REGISTRY__ as {
      resetFixtureOverrides: () => void
      overrideFixture: (domain: string, key: string, data: unknown) => void
    }
    registry.resetFixtureOverrides()
    registry.overrideFixture('schemaObjects', 'table', data)
  }, tables)
}

function objectBrowser(page: Page): Locator {
  return page.getByTestId('object-browser')
}

function treeScroller(page: Page): Locator {
  return page.getByTestId('object-browser-scroll')
}

function ecommerceStickyRow(page: Page): Locator {
  return objectBrowser(page)
    .locator('[data-database-section]')
    .filter({ has: page.getByText('ecommerce_db', { exact: true }) })
    .locator('[data-testid^="tree-node-sticky-"]')
}

function treeRow(page: Page, label: string): Locator {
  return objectBrowser(page).getByRole('treeitem').filter({ hasText: label }).first()
}

async function expandEcommerceTables(page: Page): Promise<void> {
  await objectBrowser(page).getByText('ecommerce_db', { exact: true }).click()
  await objectBrowser(page).getByText('Tables', { exact: true }).first().click()
  await expect(treeRow(page, 'table_060')).toBeAttached({ timeout: APP_READY_MS })
}

async function activeTabId(page: Page): Promise<string | null> {
  return page.evaluate((sessionId) => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { activeTabByConnection: Record<string, string | null> }
    }
    return store.getState().activeTabByConnection[sessionId] ?? null
  }, SAMPLE_SESSION_ID)
}

test.describe('object browser pinned database row and reveal', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page)
    await overrideTableList(page, MANY_TABLES)
    await connectToSample(page)
  })

  test('pins the database row while scrolling and reveals it on click', async ({ page }) => {
    await expandEcommerceTables(page)
    await expect(page.getByTestId('connection-active-database')).toContainText('ecommerce_db')

    const scroller = treeScroller(page)
    const sticky = ecommerceStickyRow(page)
    await expect(sticky).not.toHaveAttribute('data-pinned', 'true')

    await scroller.evaluate((el) => {
      el.scrollTop = 600
    })
    await expect(sticky).toHaveAttribute('data-pinned', 'true')

    const scrollerBox = await scroller.boundingBox()
    const stickyBox = await sticky.boundingBox()
    expect(scrollerBox).not.toBeNull()
    expect(stickyBox).not.toBeNull()
    expect(Math.abs((stickyBox?.y ?? 0) - (scrollerBox?.y ?? 0))).toBeLessThanOrEqual(1)

    await sticky.getByRole('treeitem').click()

    await expect(sticky).not.toHaveAttribute('data-pinned', 'true')
    // The database stays expanded: clicking the pinned row reveals instead of collapsing
    await expect(treeRow(page, 'table_001')).toBeVisible()
  })

  test('reveals the active tab object from the tab menu and with Shift+F1', async ({ page }) => {
    await expandEcommerceTables(page)
    await treeRow(page, 'table_045').click()
    const tabId = await activeTabId(page)
    expect(tabId).not.toBeNull()

    const scroller = treeScroller(page)
    const row = treeRow(page, 'table_045')

    // Context menu
    await scroller.evaluate((el) => {
      el.scrollTop = 0
    })
    await expect(row).not.toBeInViewport()
    await activeWorkspaceTabMembers(page)
      .getByTestId(`workspace-tab-${tabId}`)
      .click({ button: 'right' })
    const item = page.getByTestId('tab-context-menu-item-reveal-in-object-browser')
    await expect(item).toContainText('Shift F1')
    await item.click()

    await expect(row).toBeFocused({ timeout: APP_READY_MS })
    await expect(row).toBeInViewport()
    await expect(row).toHaveAttribute('aria-selected', 'true')
    // The revealed row sits below the pinned database row, not under it
    const sticky = ecommerceStickyRow(page)
    const rowBox = await row.boundingBox()
    const stickyBox = await sticky.boundingBox()
    expect((rowBox?.y ?? 0) + 0.5).toBeGreaterThanOrEqual(
      (stickyBox?.y ?? 0) + (stickyBox?.height ?? 0)
    )

    // Keyboard shortcut from the workspace tab
    await scroller.evaluate((el) => {
      el.scrollTop = 0
    })
    await expect(row).not.toBeInViewport()
    await activeWorkspaceTabMembers(page).getByTestId(`workspace-tab-${tabId}`).focus()
    await page.keyboard.press('Shift+F1')

    await expect(row).toBeFocused({ timeout: APP_READY_MS })
    await expect(row).toBeInViewport()
    // Revealing shows the selection, not the keyboard focus ring
    await expect(row).toHaveCSS('box-shadow', 'none')

    // The ring comes back as soon as the user navigates with the keyboard
    await page.keyboard.press('ArrowDown')
    const nextRow = treeRow(page, 'table_046')
    await expect(nextRow).toBeFocused()
    await expect(nextRow).not.toHaveCSS('box-shadow', 'none')
  })
})
