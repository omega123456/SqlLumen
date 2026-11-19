import { expect, test, type Page } from '@playwright/test'
import { APP_READY_MS, connectToSample, openSampleProfile, waitForApp } from './helpers'

async function denyLoginsWithoutPassword(page: Page) {
  await page.evaluate(() => {
    const registry = (window as unknown as Record<string, unknown>)
      .__PLAYWRIGHT_FIXTURE_REGISTRY__ as {
      overrideStaticFixture: (name: string, value: unknown) => void
      getStaticFixture: (name: string) => Array<Record<string, unknown>>
    }
    registry.overrideStaticFixture('openConnectionDenial', {
      kind: 'accessDenied',
      message: "Access denied for user 'appuser'",
    })
    const withoutPassword = registry
      .getStaticFixture('savedConnections')
      .map((profile) => ({ ...profile, hasPassword: false }))
    registry.overrideStaticFixture('savedConnections', withoutPassword)
  })
}

/** The mock list is static, so list the profile that save_connection is about to create. */
async function listNextSavedProfile(page: Page, name: string) {
  await page.evaluate((profileName) => {
    const registry = (window as unknown as Record<string, unknown>)
      .__PLAYWRIGHT_FIXTURE_REGISTRY__ as {
      overrideStaticFixture: (fixtureName: string, value: unknown) => void
      getStaticFixture: (fixtureName: string) => unknown
    }
    const saved = registry.getStaticFixture('savedConnections') as Array<Record<string, unknown>>
    const newId = registry.getStaticFixture('newConnectionId')
    registry.overrideStaticFixture('savedConnections', [
      ...saved,
      { ...saved[0], id: newId, name: profileName },
    ])
  }, name)
}

async function putSampleInGroup(page: Page) {
  await page.evaluate(async () => {
    const registry = (window as unknown as Record<string, unknown>)
      .__PLAYWRIGHT_FIXTURE_REGISTRY__ as {
      overrideStaticFixture: (name: string, value: unknown) => void
      getStaticFixture: (name: string) => Array<Record<string, unknown>>
    }
    registry.overrideStaticFixture('connectionGroups', [
      {
        id: 'grp-production',
        name: 'Production',
        parentId: null,
        sortOrder: 0,
        createdAt: '2025-01-01T00:00:00.000Z',
        color: '#e0474c',
      },
    ])
    const grouped = registry
      .getStaticFixture('savedConnections')
      .map((profile) => ({ ...profile, groupId: 'grp-production', color: null }))
    registry.overrideStaticFixture('savedConnections', grouped)
    const store = (window as unknown as Record<string, unknown>).__connectionStore__ as {
      getState: () => { fetchSavedConnections: () => Promise<void> }
    }
    await store.getState().fetchSavedConnections()
  })
}

test.describe('Connections page', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page)
  })

  test('adds a server from a pasted URL and connects', async ({ page }) => {
    const composer = page.getByTestId('connections-composer')
    await composer.fill('mysql://deploy:s3cret@shop-db.acme.io:3306/shop')
    const review = page.getByTestId('url-review')
    await expect(review.getByText('shop-db.acme.io')).toBeVisible()
    await expect(review.getByText('s3cret')).toHaveCount(0)

    await listNextSavedProfile(page, 'shop-db.acme.io')
    await review.getByRole('button', { name: 'Save and connect' }).click()
    await expect(page.getByTestId('connections-page')).toBeHidden({ timeout: APP_READY_MS })
  })

  test('edits the Security section and saves it', async ({ page }) => {
    await openSampleProfile(page)
    await page.getByRole('button', { name: 'Edit Security' }).click()
    await page.getByTestId('ssl-mode-dropdown').click()
    await page.getByTestId('ssl-mode-dropdown-option-required').click()
    await expect(page.getByTestId('save-bar')).toContainText('Editing Security')

    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByTestId('save-bar')).toBeHidden({ timeout: APP_READY_MS })
  })

  test('edits a group name and colour from its pencil', async ({ page }) => {
    await putSampleInGroup(page)
    const pencil = page.getByRole('button', { name: 'Edit group Production' })
    await pencil.click()
    const popover = page.getByTestId('group-edit-popover')
    await expect(popover.getByLabel('Group name')).toBeFocused()
    await expect(popover.getByText('#e0474c')).toBeVisible()

    await popover.getByRole('button', { name: 'Choose color' }).click()
    await page.getByLabel('Hex color value').fill('#22c55e')
    await expect(popover.getByText('#22c55e')).toBeVisible()
    await popover.getByLabel('Group name').fill('Live')
    await popover.getByRole('button', { name: 'Done' }).click()

    await expect(popover).toBeHidden()
    await expect(page.getByText('Group saved')).toBeVisible()
    await expect(pencil).toBeFocused()
  })

  test('opens over a live session from + and returns with Esc', async ({ page }) => {
    await connectToSample(page, { waitForDatabaseNode: false })
    await page.getByRole('button', { name: 'Show connections' }).click()
    await expect(page.getByRole('button', { name: 'Back to Sample MySQL' })).toBeVisible()
    await expect(page.getByTestId('main-panels')).toHaveAttribute('aria-hidden', 'true')

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('connections-page')).toBeHidden()
    await expect(page.getByTestId('object-browser')).toBeVisible()
  })

  test('asks for the password when the server denies a login with no saved password', async ({
    page,
  }) => {
    await denyLoginsWithoutPassword(page)
    await page.evaluate(async () => {
      const store = (window as unknown as Record<string, unknown>).__connectionStore__ as {
        getState: () => { fetchSavedConnections: () => Promise<void> }
      }
      await store.getState().fetchSavedConnections()
    })

    await page.getByRole('button', { name: 'Connect to Sample MySQL' }).click()
    const passwordField = page.getByLabel('Password for Sample MySQL')
    await expect(passwordField).toBeVisible({ timeout: APP_READY_MS })
    await passwordField.fill('secret')
    await passwordField.press('Enter')
    await expect(page.getByTestId('connections-page')).toBeHidden({ timeout: APP_READY_MS })
  })
})
