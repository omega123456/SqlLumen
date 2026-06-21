import { expect, test, type Page } from '@playwright/test'
import { APP_READY_MS, connectToSample, waitForApp } from './helpers'

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
  await expect(page.getByTestId('column-type-4')).toBeVisible({ timeout: APP_READY_MS })
}

test('table designer type dropdown opens upward when the bottom row lacks space below', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 520 })
  await waitForApp(page)
  await openTableDesignerTab(page)

  const scroller = page.getByTestId('column-editor-scroller')
  await expect(scroller).toBeVisible({ timeout: APP_READY_MS })
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })

  const input = page.getByTestId('column-type-4')

  await input.click()

  const dropdown = page.getByRole('listbox')
  await expect(dropdown).toBeVisible({ timeout: APP_READY_MS })

  // Clicking the cell focuses it, which scrolls the (short) column-editor scroller to bring the
  // row fully into view. The dropdown anchors to the trigger's post-scroll position, so measure
  // the input only after the dropdown has opened — comparing against the pre-click box would use a
  // stale position once the scroll shifts the row.
  const inputBox = await input.boundingBox()
  expect(inputBox).not.toBeNull()

  const dropdownBox = await dropdown.boundingBox()
  expect(dropdownBox).not.toBeNull()

  const scrollerBox = await scroller.boundingBox()
  expect(scrollerBox).not.toBeNull()

  const spaceBelow = scrollerBox!.y + scrollerBox!.height - (inputBox!.y + inputBox!.height)

  expect(spaceBelow).toBeLessThan(120)
  expect(dropdownBox!.y + dropdownBox!.height).toBeLessThanOrEqual(inputBox!.y + 2)

  await expect(dropdown.evaluate((el) => el.parentElement === document.body)).resolves.toBe(true)

  const vp = page.viewportSize()
  expect(vp).not.toBeNull()
  expect(dropdownBox!.y).toBeGreaterThanOrEqual(-1)
  expect(dropdownBox!.y + dropdownBox!.height).toBeLessThanOrEqual(vp!.height + 1)
  expect(dropdownBox!.x).toBeGreaterThanOrEqual(-1)
  expect(dropdownBox!.x + dropdownBox!.width).toBeLessThanOrEqual(vp!.width + 1)
})
