import { test, expect, type Page } from '@playwright/test'
import { APP_READY_MS, waitForApp } from './helpers'

/**
 * Override the snapshot list fixture (e.g. to an empty array for the empty state)
 * through the fixture registry — never inline in the mock router.
 */
async function overrideSnapshotList(page: Page, list: unknown): Promise<void> {
  await page.evaluate((data) => {
    const registry = (window as unknown as Record<string, unknown>)
      .__PLAYWRIGHT_FIXTURE_REGISTRY__ as {
      resetFixtureOverrides: () => void
      overrideFixture: (domain: string, key: string, data: unknown) => void
    }
    registry.resetFixtureOverrides()
    registry.overrideFixture('snapshotList', 'default', data)
  }, list)
}

/** Open the Session Snapshots dialog from the toolbar button and wait for it to mount. */
async function openSnapshotDialog(page: Page): Promise<void> {
  await page.getByTestId('snapshots-button').click()
  await expect(page.getByTestId('snapshot-dialog')).toBeVisible({ timeout: APP_READY_MS })
}

test.describe('session snapshots', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page)
  })

  test('opens the snapshot dialog from the toolbar button', async ({ page }) => {
    await openSnapshotDialog(page)
    await expect(page.getByText('Session Snapshots')).toBeVisible()
  })

  test('renders snapshot rows from fixture data', async ({ page }) => {
    await openSnapshotDialog(page)

    // Three default fixture rows (ids 3, 2, 1) render newest-first.
    await expect(page.getByTestId('snapshot-row-3')).toBeVisible()
    await expect(page.getByTestId('snapshot-row-2')).toBeVisible()
    await expect(page.getByTestId('snapshot-row-1')).toBeVisible()

    const topRow = page.getByTestId('snapshot-row-3')
    // Trigger label, counts string, and per-connection breakdown.
    await expect(topRow).toContainText('Manual')
    await expect(topRow).toContainText('3 connections · 7 tabs')
    await expect(topRow).toContainText('ProdDB: 4 · Staging: 2 · Analytics: 1')
  })

  test('selecting a row enables the Restore button', async ({ page }) => {
    await openSnapshotDialog(page)

    const restoreButton = page.getByTestId('snapshot-restore-button')
    await expect(restoreButton).toBeDisabled()

    await page.getByTestId('snapshot-row-3').click()
    await expect(restoreButton).toBeEnabled()
  })

  test('restore opens a confirmation showing the snapshot timestamp, then cancels', async ({
    page,
  }) => {
    await openSnapshotDialog(page)

    await page.getByTestId('snapshot-row-3').click()
    await page.getByTestId('snapshot-restore-button').click()

    const confirmDialog = page.getByTestId('confirm-dialog')
    await expect(confirmDialog).toBeVisible()
    await expect(confirmDialog).toContainText('Restore this snapshot?')
    // Timestamp from the selected snapshot's createdAt (2026-06-05T14:32:00Z).
    await expect(confirmDialog).toContainText('2026')

    await page.getByTestId('confirm-cancel-button').click()
    await expect(confirmDialog).toBeHidden()
    // The snapshot dialog remains open after cancelling.
    await expect(page.getByTestId('snapshot-dialog')).toBeVisible()
  })

  test('create opens a non-destructive confirmation, then cancels', async ({ page }) => {
    await openSnapshotDialog(page)

    await page.getByTestId('snapshot-create-button').click()

    const confirmDialog = page.getByTestId('confirm-dialog')
    await expect(confirmDialog).toBeVisible()
    await expect(confirmDialog).toContainText('Create snapshot?')
    // The confirm action label is the non-destructive "Create Snapshot".
    await expect(page.getByTestId('confirm-confirm-button')).toContainText('Create Snapshot')

    await page.getByTestId('confirm-cancel-button').click()
    await expect(confirmDialog).toBeHidden()
    await expect(page.getByTestId('snapshot-dialog')).toBeVisible()
  })

  test('delete opens a confirmation after revealing the row delete button, then cancels', async ({
    page,
  }) => {
    await openSnapshotDialog(page)

    // The delete button is opacity:0 until the row is hovered/focused.
    const row = page.getByTestId('snapshot-row-1')
    await row.hover()
    const deleteButton = page.getByTestId('snapshot-delete-1')
    await deleteButton.click()

    const confirmDialog = page.getByTestId('confirm-dialog')
    await expect(confirmDialog).toBeVisible()
    await expect(confirmDialog).toContainText('Delete snapshot?')

    await page.getByTestId('confirm-cancel-button').click()
    await expect(confirmDialog).toBeHidden()
    await expect(page.getByTestId('snapshot-dialog')).toBeVisible()
  })

  test('shows the empty state when there are no snapshots', async ({ page }) => {
    await overrideSnapshotList(page, [])
    await openSnapshotDialog(page)

    await expect(page.getByText('No snapshots yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create your first snapshot' })).toBeVisible()
  })
})
