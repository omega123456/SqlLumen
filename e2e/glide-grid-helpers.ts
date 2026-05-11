import type { Locator, Page } from '@playwright/test'

export interface GlideGridGeometry {
  headerHeight: number
  rowHeight: number
  rowMarkerWidth: number
  columnWidths: number[]
  scrollLeft: number
  scrollTop: number
  boundingBox: { x: number; y: number; width: number; height: number }
}

export async function getGlideGrid(page: Page, testId: string): Promise<Locator> {
  return page.getByTestId(testId)
}

export async function getGlideGridGeometry(page: Page, testId: string): Promise<GlideGridGeometry> {
  const grid = await getGlideGrid(page, testId)
  const box = await grid.boundingBox()
  if (!box) throw new Error(`Glide grid ${testId} has no bounding box`)

  return grid.evaluate((el) => {
    const cs = getComputedStyle(document.documentElement)
    const headerHeight = parseFloat(cs.getPropertyValue('--grid-header-height')) || 32
    const rowHeight = parseFloat(cs.getPropertyValue('--grid-row-height')) || 32
    const scroller = el.querySelector<HTMLElement>('.dvn-scroller') ?? (el as HTMLElement)
    const parsedWidths: unknown = JSON.parse((el as HTMLElement).dataset.glideColumnWidth ?? '[]')
    const columnWidths = Array.isArray(parsedWidths)
      ? parsedWidths.filter((width): width is number => typeof width === 'number' && width > 0)
      : []
    const rect = el.getBoundingClientRect()
    return {
      headerHeight,
      rowHeight,
      rowMarkerWidth: parseFloat((el as HTMLElement).dataset.rowMarkerWidth ?? '0') || 0,
      columnWidths,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    }
  })
}

export async function scrollGlideColumnIntoView(
  page: Page,
  testId: string,
  colIdx: number,
  padding = 16
): Promise<GlideGridGeometry> {
  const maxAttempts = 12

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const geometry = await getGlideGridGeometry(page, testId)
    const width = geometry.columnWidths[colIdx]
    if (width == null) {
      throw new Error(`Glide grid column index ${colIdx} is out of range`)
    }

    const columnStart = columnOffset(geometry, colIdx)
    const columnEnd = columnStart + width
    const visibleStart = geometry.scrollLeft
    const visibleEnd = geometry.scrollLeft + geometry.boundingBox.width

    if (columnStart >= visibleStart + padding && columnEnd <= visibleEnd - padding) {
      return geometry
    }

    const deltaX =
      columnStart < visibleStart + padding
        ? columnStart - (visibleStart + padding)
        : columnEnd - (visibleEnd - padding)

    await page.mouse.move(
      geometry.boundingBox.x + geometry.boundingBox.width / 2,
      geometry.boundingBox.y + geometry.headerHeight + geometry.rowHeight / 2
    )
    await page.mouse.wheel(deltaX, 0)
  }

  return getGlideGridGeometry(page, testId)
}

export async function getColumnX(gridLocator: Locator, colIndex: number): Promise<number> {
  return gridLocator.evaluate((el, columnIndex) => {
    const host = el as HTMLElement
    const parsedWidths: unknown = JSON.parse(host.dataset.glideColumnWidth ?? '[]')
    if (!Array.isArray(parsedWidths)) throw new Error('Glide grid column widths must be an array')
    const columnWidths = parsedWidths.map((width, index) => {
      if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
        throw new Error(`Glide grid column width at index ${index} is invalid`)
      }
      return width
    })
    const width = columnWidths[columnIndex]
    if (width === undefined)
      throw new Error(`Glide grid column index ${columnIndex} is out of range`)

    const rowMarkerWidth = parseFloat(host.dataset.rowMarkerWidth ?? '0') || 0
    return (
      rowMarkerWidth +
      columnWidths.slice(0, columnIndex).reduce((sum, next) => sum + next, 0) +
      width / 2
    )
  }, colIndex)
}

function columnOffset(geometry: GlideGridGeometry, colIdx: number): number {
  let x = geometry.rowMarkerWidth
  for (let i = 0; i < colIdx; i += 1) x += geometry.columnWidths[i] ?? 0
  return x
}

export function getGlideCellPoint(
  geometry: GlideGridGeometry,
  colIdx: number,
  rowIdx: number
): { x: number; y: number } {
  return {
    x: columnOffset(geometry, colIdx) - geometry.scrollLeft + (geometry.columnWidths[colIdx] ?? 0) / 2,
    y:
      geometry.headerHeight -
      geometry.scrollTop +
      rowIdx * geometry.rowHeight +
      geometry.rowHeight / 2,
  }
}

export function getGlideHeaderPoint(
  geometry: GlideGridGeometry,
  colIdx: number
): { x: number; y: number } {
  return { x: columnOffset(geometry, colIdx) - geometry.scrollLeft + 8, y: geometry.headerHeight / 2 }
}

async function clickAt(
  page: Page,
  testId: string,
  x: number,
  y: number,
  clickCount = 1
) {
  const grid = await getGlideGrid(page, testId)
  const canvas = grid.locator('canvas[data-testid="data-grid-canvas"]').first()
  await canvas.click({ position: { x, y }, force: true, clickCount })
}

export async function clickGlideCell(
  page: Page,
  testId: string,
  colIdx: number,
  rowIdx: number,
  geometry: GlideGridGeometry
): Promise<void> {
  const point = getGlideCellPoint(geometry, colIdx, rowIdx)
  await clickAt(page, testId, point.x, point.y)
}

export async function dblClickGlideCell(
  page: Page,
  testId: string,
  colIdx: number,
  rowIdx: number,
  geometry: GlideGridGeometry
): Promise<void> {
  const point = getGlideCellPoint(geometry, colIdx, rowIdx)
  await clickAt(page, testId, point.x, point.y, 2)
}

export async function clickGlideHeader(
  page: Page,
  testId: string,
  colIdx: number,
  geometry: GlideGridGeometry
): Promise<void> {
  const point = getGlideHeaderPoint(geometry, colIdx)
  await clickAt(page, testId, point.x, point.y)
}

export async function clickGlideRowMarker(
  page: Page,
  testId: string,
  rowIdx: number,
  geometry: GlideGridGeometry
): Promise<void> {
  await clickAt(
    page,
    testId,
    geometry.rowMarkerWidth / 2,
    geometry.headerHeight -
      geometry.scrollTop +
      rowIdx * geometry.rowHeight +
      geometry.rowHeight / 2
  )
}

export async function clickGlideFkEllipsis(
  page: Page,
  testId: string,
  colIdx: number,
  rowIdx: number,
  geometry: GlideGridGeometry
): Promise<void> {
  const width = geometry.columnWidths[colIdx] ?? 0
  await clickAt(
    page,
    testId,
    columnOffset(geometry, colIdx) - geometry.scrollLeft + width - 8,
    geometry.headerHeight -
      geometry.scrollTop +
      rowIdx * geometry.rowHeight +
      geometry.rowHeight / 2
  )
}
