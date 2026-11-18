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

const NO_BOX_SHADOW = 'none'
const TRANSPARENT_EMPTY_SHADOW_LAYER = /rgba\(0, 0, 0, 0\) 0px 0px 0px 0px/g
const SHADOW_LAYER_SEPARATOR = /^[, ]+|[, ]+$/g

export type ThemeName = 'light' | 'dark'

export async function currentTheme(page: Page): Promise<ThemeName> {
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  return isDark ? 'dark' : 'light'
}

export async function visibleBoxShadow(locator: Locator): Promise<string> {
  const boxShadow = await locator.evaluate((element) => getComputedStyle(element).boxShadow)
  const visibleLayers = boxShadow
    .replace(TRANSPARENT_EMPTY_SHADOW_LAYER, '')
    .replace(SHADOW_LAYER_SEPARATOR, '')
  return visibleLayers.trim() || NO_BOX_SHADOW
}

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

/** Locator for a pinned tab (History, Process list) at the bottom of the active connection's rail. */
export function activePinnedTab(page: Page, type: 'history' | 'processlist'): Locator {
  return activeConnectionWorkspace(page).getByTestId(`workspace-pinned-tab-${type}`)
}

/** Locator for one item of the active connection's tab-group rail, scoped to the visible root. */
export function activeGroupRailItem(page: Page, stackKey: string): Locator {
  return activeConnectionWorkspace(page).getByTestId(`workspace-group-rail-item-${stackKey}`)
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
        Number.parseFloat(computedStyle.getPropertyValue('--spacing-grid-header').trim()) || 32,
      rowHeight:
        Number.parseFloat(computedStyle.getPropertyValue('--spacing-grid-row').trim()) || 32,
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

export interface SavedConnectionsFixture {
  savedConnections: unknown[]
  connectionGroups: unknown[]
}

/** Replace the saved profiles through the fixture registry, then reload them into the app. */
export async function overrideSavedConnections(page: Page, fixture: SavedConnectionsFixture) {
  await page.evaluate(async (data) => {
    const target = window as unknown as Record<string, unknown>
    const registry = target.__PLAYWRIGHT_FIXTURE_REGISTRY__ as {
      overrideStaticFixture: (name: string, value: unknown) => void
    }
    registry.overrideStaticFixture('savedConnections', data.savedConnections)
    registry.overrideStaticFixture('connectionGroups', data.connectionGroups)
    const connectionStore = target.__connectionStore__ as {
      getState: () => { fetchSavedConnections: () => Promise<void> }
    }
    await connectionStore.getState().fetchSavedConnections()
  }, fixture)
}

export async function openConnectionsPage(page: Page) {
  const connectionsPage = page.getByTestId('connections-page')
  if (!(await connectionsPage.isVisible())) {
    await page.getByRole('button', { name: 'Show connections' }).click()
  }
  await expect(connectionsPage).toBeVisible({ timeout: APP_READY_MS })
  await expect(
    connectionsPage.getByRole('button', { name: 'Connect to Sample MySQL' }).first()
  ).toBeVisible({ timeout: APP_READY_MS })
}

export async function openSampleProfile(page: Page) {
  await openConnectionsPage(page)
  await page.getByRole('button', { name: 'Edit Sample MySQL' }).first().click()
  await expect(page.getByTestId('connection-profile')).toBeVisible({ timeout: APP_READY_MS })
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

  await openConnectionsPage(page)
  await page.getByRole('button', { name: 'Connect to Sample MySQL' }).first().click()
  await expect(page.getByTestId('connections-page')).toBeHidden({ timeout: APP_READY_MS })
  await expect(page.getByTestId('object-browser')).toBeVisible({ timeout: APP_READY_MS })
  await expect(page.getByTestId('status-bar')).toContainText('Connected', { timeout: APP_READY_MS })

  if (waitForDatabaseNode) {
    await expect(
      page.getByTestId('object-browser').getByRole('tree').getByText('ecommerce_db')
    ).toBeVisible({
      timeout: APP_READY_MS,
    })
  }

  if (dismissToasts) {
    await dismissAllToasts(page)
  }
}

/** Wait until the visible editor's semantic tokens match its current content. */
export async function waitForSemanticHighlighting(scope: Page | Locator) {
  const visibleEditor = scope.getByTestId('monaco-editor-wrapper').filter({ visible: true }).first()
  await expect(visibleEditor).toHaveAttribute('data-semantic-highlighting', 'ready', {
    timeout: APP_READY_MS,
  })
}
