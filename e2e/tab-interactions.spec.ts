import { expect, test, type Page } from '@playwright/test'
import { APP_READY_MS, connectToSample, waitForApp } from './helpers'

const SAMPLE_SESSION_ID = 'session-playwright-1'

function activePanel(page: Page) {
  return page.locator('[data-testid="workspace-panel"][data-active="true"]')
}

async function openQueryTab(page: Page) {
  await page.getByTestId('new-query-tab-button').click()

  return page.evaluate((sessionId) => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => {
        activeTabByConnection: Record<string, string | null>
      }
    }

    return store.getState().activeTabByConnection[sessionId]
  }, SAMPLE_SESSION_ID)
}

async function workspaceQueryTabOrder(page: Page) {
  return page.evaluate((sessionId) => {
    const store = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => {
        tabsByConnection: Record<string, Array<{ id: string; type: string; label: string }>>
      }
    }

    return (store.getState().tabsByConnection[sessionId] ?? [])
      .filter((tab) => tab.type === 'query-editor')
      .map((tab) => tab.label)
  }, SAMPLE_SESSION_ID)
}

async function renderedWorkspaceQueryTabOrder(page: Page) {
  return page.evaluate(() => {
    const activeWorkspace = document.querySelector('[data-testid="active-connection-workspace"]')
    const root = (activeWorkspace ?? document).querySelector('[data-testid="workspace-tabs"]')
    if (!root) {
      return []
    }

    const rail = root.querySelector(':scope > div > div')
    if (!rail) {
      return []
    }

    return Array.from(rail.children)
      .map((element) => ({
        testId: element.getAttribute('data-testid') ?? '',
        label: element.querySelector('[role="button"]')?.textContent?.trim() ?? '',
      }))
      .filter((tab) => tab.testId.startsWith('workspace-tab-') && tab.label.length > 0)
      .map((tab) => tab.label)
  })
}

async function openSecondConnectionSession(page: Page) {
  await page.evaluate(() => {
    const useConnectionStore = (window as unknown as Record<string, unknown>)
      .__connectionStore__ as {
      setState: (
        fn: (state: {
          activeConnections: Record<
            string,
            { id: string; profile: Record<string, unknown>; status: string; serverVersion: string }
          >
          activeConnectionOrder: string[]
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
      activeConnectionOrder: ['session-playwright-1', 'session-playwright-2'],
    }))
  })

  await expect(page.getByTestId('connection-session-tab-session-playwright-2')).toBeVisible({
    timeout: APP_READY_MS,
  })
}

test.describe('Tab interactions', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page)
  })

  test('renames a query tab via context menu action', async ({ page }) => {
    await connectToSample(page)
    await page.getByTestId('new-query-tab-button').click()
    await expect(activePanel(page).getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

    const tab = page.getByText('Query 1').first()
    await expect(tab).toBeVisible({ timeout: APP_READY_MS })

    await tab.click({ button: 'right' })
    await expect(page.getByTestId('tab-context-menu')).toBeVisible({ timeout: APP_READY_MS })
    await page.getByTestId('tab-context-menu-item-rename').click()

    const renameInput = page.getByTestId('workspace-tab-rename-input')
    await expect(renameInput).toBeVisible({ timeout: APP_READY_MS })
    await renameInput.fill('Revenue Query')
    await renameInput.press('Enter')

    await expect(page.getByText('Revenue Query').first()).toBeVisible({ timeout: APP_READY_MS })
  })

  test('moves workspace query tabs with context menu actions', async ({ page }) => {
    await connectToSample(page)
    const firstQueryTabId = await openQueryTab(page)
    const secondQueryTabId = await openQueryTab(page)
    await expect(activePanel(page).getByTestId('query-editor-tab')).toBeVisible({ timeout: APP_READY_MS })

    await page.getByTestId(`workspace-tab-${firstQueryTabId}`).click({ button: 'right' })
    await expect(page.getByTestId('tab-context-menu')).toBeVisible({ timeout: APP_READY_MS })
    await page.getByTestId('tab-context-menu-item-move-right').click()

    const filtered = await workspaceQueryTabOrder(page)
    expect(filtered[0]).toContain('Query 2')
    expect(filtered[1]).toContain('Query 1')
    await expect.poll(() => renderedWorkspaceQueryTabOrder(page)).toEqual(['Query 2', 'Query 1'])

    await page.getByTestId(`workspace-tab-${secondQueryTabId}`).click({ button: 'right' })
    await page.getByTestId('tab-context-menu-item-move-end').click()
    const movedEndQueries = await workspaceQueryTabOrder(page)
    expect(movedEndQueries[0]).toContain('Query 1')
    expect(movedEndQueries[1]).toContain('Query 2')
    await expect.poll(() => renderedWorkspaceQueryTabOrder(page)).toEqual(['Query 1', 'Query 2'])

    await page.getByTestId(`workspace-tab-${secondQueryTabId}`).click({ button: 'right' })
    await page.getByTestId('tab-context-menu-item-move-start').click()
    const movedStartQueries = await workspaceQueryTabOrder(page)
    expect(movedStartQueries[0]).toContain('Query 2')
    expect(movedStartQueries[1]).toContain('Query 1')
    await expect.poll(() => renderedWorkspaceQueryTabOrder(page)).toEqual(['Query 2', 'Query 1'])
  })

  test('reorders connection tabs from context menu actions', async ({ page }) => {
    await connectToSample(page)
    await openSecondConnectionSession(page)

    const firstTab = page.getByTestId('connection-session-tab-session-playwright-1')
    const secondTab = page.getByTestId('connection-session-tab-session-playwright-2')
    await expect(firstTab).toBeVisible({ timeout: APP_READY_MS })
    await expect(secondTab).toBeVisible({ timeout: APP_READY_MS })

    await secondTab.click({ button: 'right' })
    await expect(page.getByTestId('tab-context-menu')).toBeVisible({ timeout: APP_READY_MS })
    await page.getByTestId('tab-context-menu-item-move-left').click()

    const orderedNames = await page
      .locator('[data-testid="connection-tab-bar"] [data-testid^="connection-session-tab-"]')
      .allTextContents()
    expect(orderedNames.slice(0, 2)).toEqual(['Staging MySQL', 'Sample MySQL'])

    await secondTab.click({ button: 'right' })
    await page.getByTestId('tab-context-menu-item-move-end').click()
    const movedEndNames = await page
      .locator('[data-testid="connection-tab-bar"] [data-testid^="connection-session-tab-"]')
      .allTextContents()
    expect(movedEndNames.slice(0, 2)).toEqual(['Sample MySQL', 'Staging MySQL'])

    await secondTab.click({ button: 'right' })
    await page.getByTestId('tab-context-menu-item-move-start').click()
    const movedStartNames = await page
      .locator('[data-testid="connection-tab-bar"] [data-testid^="connection-session-tab-"]')
      .allTextContents()
    expect(movedStartNames.slice(0, 2)).toEqual(['Staging MySQL', 'Sample MySQL'])
  })
})
