import { expect, type Locator, type Page } from '@playwright/test'
import {
  clickGlideCell,
  clickGlideHeader,
  getGlideGridGeometry,
  clickGlideFkEllipsis,
  dblClickGlideCell,
  type GlideGridGeometry,
} from './glide-grid-helpers'

export const APP_READY_MS = 5_000

interface GridPointHandle {
  click: () => Promise<void>
  dblClick: () => Promise<void>
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number }>
  locator: (selector: string) => Locator
  getByTestId: (testId: string) => Locator
  getByRole: (
    role: Parameters<Locator['getByRole']>[0],
    options?: Parameters<Locator['getByRole']>[1]
  ) => Locator
  toContainTextTarget: Locator
}

const APP_BOOT_ATTEMPTS = 3
const GOTO_RETRY_ATTEMPTS = 2
const GOTO_RETRY_DELAY_MS = 500

export async function waitForApp(page: Page) {
  for (let appAttempt = 0; appAttempt < APP_BOOT_ATTEMPTS; appAttempt++) {
    try {
      for (let gotoAttempt = 0; gotoAttempt < GOTO_RETRY_ATTEMPTS; gotoAttempt++) {
        try {
          await page.goto('/', { waitUntil: 'load', timeout: APP_READY_MS })
          break
        } catch (error) {
          if (gotoAttempt === GOTO_RETRY_ATTEMPTS - 1) {
            throw error
          }

          await page.waitForTimeout(GOTO_RETRY_DELAY_MS)
        }
      }

      await expect(page.getByTestId('app-layout')).toBeVisible({ timeout: APP_READY_MS })
      await expect(page.getByTestId('status-bar')).toContainText('Ready', {
        timeout: APP_READY_MS,
      })
      await page.evaluate(() => document.fonts.ready)
      return
    } catch (error) {
      if (appAttempt === APP_BOOT_ATTEMPTS - 1) {
        throw error
      }

      await page.waitForTimeout(GOTO_RETRY_DELAY_MS)
    }
  }
}

/**
 * Locator for the currently visible (active) connection-workspace root.
 *
 * Retained inactive connection workspaces intentionally duplicate descendant
 * `workspace-tabs` and `workspace-panel` test IDs. Shell-level interactions must
 * scope through this root so duplicated rails do not create ambiguous selectors.
 */
export function activeConnectionWorkspace(page: Page): Locator {
  return page.getByTestId('active-connection-workspace')
}

/** Locator for the active connection's workspace-tabs rail, scoped to the visible root. */
export function activeWorkspaceTabs(page: Page): Locator {
  return activeConnectionWorkspace(page).getByTestId('workspace-tabs')
}

/** Locator for the active connection's workspace member-tab rail, scoped to the visible root. */
export function activeWorkspaceTabMembers(page: Page): Locator {
  return activeConnectionWorkspace(page).getByTestId('workspace-tab-members')
}

export async function getColumnIndexByName(grid: Locator, columnName: string) {
  const headerIndex = await grid.evaluate((element, targetName) => {
    const testId = element.getAttribute('data-testid')
    const normalizedTarget = targetName.trim().toLowerCase()

    const resolveIndex = (columns: Array<{ name?: string }> | undefined) =>
      columns?.findIndex((column) => column?.name?.trim().toLowerCase() === normalizedTarget) ?? -1

    const readTableDataColumns = () => {
      const store = (
        window as unknown as {
          __tableDataStore__?: {
            getState?: () => {
              tabs?: Record<string, { columns?: Array<{ name?: string }> }>
            }
          }
        }
      ).__tableDataStore__

      const tabs = store?.getState?.().tabs ?? {}
      return Object.values(tabs).flatMap((tab) => tab?.columns ?? [])
    }

    const readQueryColumns = () => {
      const store = (
        window as unknown as {
          __queryStore__?: {
            getState?: () => {
              tabs?: Record<
                string,
                {
                  activeResultIndex?: number
                  results?: Array<{ columns?: Array<{ name?: string }> }>
                }
              >
            }
          }
        }
      ).__queryStore__

      const tabs = store?.getState?.().tabs ?? {}
      return Object.values(tabs).flatMap((tab) => {
        const activeResultIndex = tab?.activeResultIndex ?? 0
        return tab?.results?.[activeResultIndex]?.columns ?? []
      })
    }

    if (testId === 'table-data-grid') {
      return resolveIndex(readTableDataColumns())
    }

    if (testId === 'result-grid') {
      return resolveIndex(readQueryColumns())
    }

    return -1
  }, columnName)

  if (headerIndex >= 0) return headerIndex
  throw new Error(`Column "${columnName}" not found in Glide grid metadata`)
}

export async function getGridCellByColumnName(
  grid: Locator,
  rowIndex: number,
  columnName: string
): Promise<GridPointHandle> {
  const targetColIdx = await getColumnIndexByName(grid, columnName)
  const geometry = await getGlideGridGeometryFromLocator(grid)
  const width = geometry.columnWidths?.[targetColIdx] ?? 150
  const x = getColumnStartOffset(geometry, targetColIdx) - geometry.scrollLeft + width / 2
  const y =
    geometry.headerHeight -
    geometry.scrollTop +
    rowIndex * geometry.rowHeight +
    geometry.rowHeight / 2

  return {
    click: () => grid.click({ position: { x, y }, force: true }),
    dblClick: () => grid.click({ position: { x, y }, force: true, clickCount: 2 }),
    boundingBox: async () => {
      const box = await grid.boundingBox()
      if (!box) throw new Error('Glide grid is not visible')
      return {
        x: box.x + x - width / 2,
        y: box.y + y - geometry.rowHeight / 2,
        width,
        height: geometry.rowHeight,
      }
    },
    locator: (selector: string) => grid.locator(selector),
    getByTestId: (testId: string) => grid.getByTestId(testId),
    getByRole: (role, options) => grid.getByRole(role, options),
    toContainTextTarget: grid,
  }
}

export async function getGridHeaderCellByColumnName(
  grid: Locator,
  columnName: string
): Promise<GridPointHandle> {
  const targetColIdx = await getColumnIndexByName(grid, columnName)
  const geometry = await getGlideGridGeometryFromLocator(grid)
  const width = geometry.columnWidths?.[targetColIdx] ?? 150
  const x = getColumnStartOffset(geometry, targetColIdx) - geometry.scrollLeft + width / 2
  const y = geometry.headerHeight / 2

  return {
    click: () => grid.click({ position: { x, y }, force: true }),
    dblClick: () => grid.click({ position: { x, y }, force: true, clickCount: 2 }),
    boundingBox: async () => {
      const box = await grid.boundingBox()
      if (!box) throw new Error('Glide grid is not visible')
      return {
        x: box.x + x - width / 2,
        y: box.y,
        width,
        height: geometry.headerHeight,
      }
    },
    locator: (selector: string) => grid.locator(selector),
    getByTestId: (testId: string) => grid.getByTestId(testId),
    getByRole: (role, options) => grid.getByRole(role, options),
    toContainTextTarget: grid,
  }
}

async function getGlideGridGeometryFromLocator(grid: Locator): Promise<GlideGridGeometry> {
  return grid.evaluate((element) => {
    const host = element as HTMLElement
    const computedStyle = getComputedStyle(document.documentElement)
    const parsedColumnWidths = JSON.parse(host.dataset.glideColumnWidth ?? '[]') as unknown
    const columnWidths = Array.isArray(parsedColumnWidths)
      ? parsedColumnWidths.filter(
          (value): value is number =>
            typeof value === 'number' && Number.isFinite(value) && value > 0
        )
      : []
    const rowMarkerWidth = Number.parseFloat(host.dataset.rowMarkerWidth ?? '0') || 0
    const scroller = host.querySelector<HTMLElement>('.dvn-scroller') ?? host
    const box = host.getBoundingClientRect()

    return {
      width: box.width,
      height: box.height,
      rowMarkerWidth,
      headerHeight:
        Number.parseFloat(computedStyle.getPropertyValue('--grid-header-height').trim()) || 32,
      rowHeight:
        Number.parseFloat(computedStyle.getPropertyValue('--grid-row-height').trim()) || 32,
      columnWidths,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
      boundingBox: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
    }
  })
}

function getColumnStartOffset(geometry: GlideGridGeometry, columnIndex: number): number {
  let offset = geometry.rowMarkerWidth
  for (let index = 0; index < columnIndex; index += 1) {
    offset += geometry.columnWidths[index] ?? 150
  }
  return offset
}

export async function waitForGlideGrid(page: Page, testId: string) {
  const grid = page.getByTestId(testId)
  await expect(grid).toBeVisible({ timeout: APP_READY_MS })
  await expect(grid.locator('canvas').first()).toBeVisible({ timeout: APP_READY_MS })
  return grid
}

export async function waitForResultGrid(page: Page) {
  return waitForGlideGrid(page, 'result-grid')
}

export async function clickResultGridHeader(page: Page, columnIndex: number) {
  const geometry = await getGlideGridGeometry(page, 'result-grid')
  await clickGlideHeader(page, 'result-grid', columnIndex, geometry)
}

export async function clickResultGridCell(page: Page, columnIndex: number, rowIndex: number) {
  const geometry = await getGlideGridGeometry(page, 'result-grid')
  await clickGlideCell(page, 'result-grid', columnIndex, rowIndex, geometry)
}

export async function activateResultGridCell(page: Page, columnIndex: number, rowIndex: number) {
  const geometry = await getGlideGridGeometry(page, 'result-grid')
  await dblClickGlideCell(page, 'result-grid', columnIndex, rowIndex, geometry)
}

export async function waitForTableDataGrid(page: Page) {
  return waitForGlideGrid(page, 'table-data-grid')
}

export async function clickTableDataCell(
  page: Page,
  colIdx: number,
  rowIdx: number,
  geometry?: GlideGridGeometry
) {
  const resolvedGeometry = geometry ?? (await getGlideGridGeometry(page, 'table-data-grid'))
  await clickGlideCell(page, 'table-data-grid', colIdx, rowIdx, resolvedGeometry)
}

export async function activateTableDataEditor(
  page: Page,
  colIdx: number,
  rowIdx: number,
  geometry?: GlideGridGeometry
) {
  const resolvedGeometry = geometry ?? (await getGlideGridGeometry(page, 'table-data-grid'))
  await dblClickGlideCell(page, 'table-data-grid', colIdx, rowIdx, resolvedGeometry)
}

export async function clickFkEllipsis(
  page: Page,
  colIdx: number,
  rowIdx: number,
  geometry?: GlideGridGeometry
) {
  const resolvedGeometry = geometry ?? (await getGlideGridGeometry(page, 'table-data-grid'))
  await clickGlideFkEllipsis(page, 'table-data-grid', colIdx, rowIdx, resolvedGeometry)
}

export async function clickFkLookupGridRow(page: Page, rowIndex: number) {
  const geometry = await getGlideGridGeometry(page, 'fk-lookup-grid')
  await clickGlideCell(page, 'fk-lookup-grid', 0, rowIndex, geometry)
}

export async function openConnectionManager(page: Page) {
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

export async function selectSampleConnection(dialog: Locator) {
  const sampleRow = dialog.getByTestId('connection-list-item').filter({ hasText: 'Sample MySQL' })
  await expect(sampleRow).toBeVisible({ timeout: APP_READY_MS })
  await sampleRow.scrollIntoViewIfNeeded()
  await expect(sampleRow).toBeEnabled({ timeout: APP_READY_MS })
  await sampleRow.click()
}

export async function dismissAllToasts(page: Page) {
  await page.evaluate(() => {
    const store = (window as unknown as Record<string, unknown>).__toastStore__ as {
      getState: () => {
        toasts: Array<{ id: string }>
        dismiss: (id: string) => void
      }
    }
    const { toasts, dismiss } = store.getState()
    toasts.forEach(({ id }) => dismiss(id))
  })
}

export async function connectToSample(
  page: Page,
  options: {
    dismissToasts?: boolean
    waitForDatabaseNode?: boolean
  } = {}
) {
  const { dismissToasts = true, waitForDatabaseNode = true } = options

  await openConnectionManager(page)
  const dialog = page.getByTestId('connection-dialog')
  await selectSampleConnection(dialog)
  const connectBtn = dialog.getByRole('button', { name: 'Save and Connect', exact: true })
  await expect(connectBtn).toBeEnabled({ timeout: APP_READY_MS })
  await connectBtn.click()
  await expect(page.getByTestId('connection-dialog')).toBeHidden({ timeout: APP_READY_MS })
  await expect(page.getByTestId('object-browser')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('status-bar')).toContainText('Connected', { timeout: APP_READY_MS })

  if (waitForDatabaseNode) {
    await expect(page.getByTestId('object-browser').getByText('ecommerce_db')).toBeVisible({
      timeout: APP_READY_MS,
    })
  }

  if (dismissToasts) {
    await dismissAllToasts(page)
  }
}
