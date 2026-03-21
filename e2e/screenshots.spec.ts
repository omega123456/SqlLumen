import { test, expect, type Page } from '@playwright/test'

const themes = ['light', 'dark'] as const

async function waitForApp(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('status-bar')).toContainText('Ready')
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
      await openConnectionManager(page)
      await page.getByText('Sample MySQL').click()
      await page
        .getByTestId('connection-dialog')
        .getByRole('button', { name: 'Connect', exact: true })
        .click()
      await expect(page.getByTestId('connection-dialog')).toBeHidden()
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
  })
}
