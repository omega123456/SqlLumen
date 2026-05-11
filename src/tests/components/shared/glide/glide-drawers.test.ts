import { describe, expect, it, vi } from 'vitest'
import {
  drawBlobText,
  drawFkEllipsis,
  drawHighlightedColumnBackground,
  drawInfoAffordance,
  drawModifiedCellIndicator,
  drawNullText,
  drawReadOnlyOverlay,
  drawSelectedRowAccent,
} from '../../../../components/shared/glide/glide-drawers'
import type { Theme } from '@glideapps/glide-data-grid'

function ctx(): CanvasRenderingContext2D {
  return {
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set font(_v: string) {},
    set textAlign(_v: CanvasTextAlign) {},
  } as unknown as CanvasRenderingContext2D
}

const theme = {
  textLight: '#999',
  textMedium: '#777',
  baseFontStyle: '13px',
  fontFamily: 'monospace',
  cellHorizontalPadding: 10,
} as Theme

describe('glide-drawers', () => {
  it('draws selected row accent', () => {
    const c = ctx()
    drawSelectedRowAccent(c, { x: 1, y: 2, width: 30, height: 40 }, '#f00')
    expect(c.fillRect).toHaveBeenCalledWith(1, 2, 2, 40)
  })
  it('draws modified indicators', () => {
    const c = ctx()
    drawModifiedCellIndicator(c, { x: 0, y: 0, width: 30, height: 20 }, '#f00', false)
    expect(c.arc).toHaveBeenCalled()
  })
  it('draws dark modified indicators', () => {
    const c = ctx()
    drawModifiedCellIndicator(c, { x: 0, y: 0, width: 30, height: 20 }, '#f00', true)
    expect(c.moveTo).toHaveBeenCalledWith(0, 6)
    expect(c.lineTo).toHaveBeenCalledWith(0, 0)
    expect(c.lineTo).toHaveBeenCalledWith(6, 0)
    expect(c.stroke).toHaveBeenCalled()
  })
  it('draws read-only overlay', () => {
    const c = ctx()
    drawReadOnlyOverlay(c, { x: 1, y: 2, width: 30, height: 40 }, '#eee')
    expect(c.fillRect).toHaveBeenCalledWith(1, 2, 30, 40)
  })
  it('draws FK ellipsis', () => {
    const c = ctx()
    drawFkEllipsis(c, { x: 0, y: 0, width: 30, height: 20 }, '#f00')
    expect(c.fillText).toHaveBeenCalledWith('…', 22, 14)
  })
  it('draws NULL text', () => {
    const c = ctx()
    drawNullText(c, { x: 0, y: 0, width: 30, height: 20 }, theme)
    expect(c.fillText).toHaveBeenCalledWith('NULL', 10, 14)
  })
  it('draws blob text', () => {
    const c = ctx()
    drawBlobText(c, { x: 0, y: 0, width: 30, height: 20 }, '[blob]', theme)
    expect(c.fillText).toHaveBeenCalledWith('[blob]', 10, 14)
  })
  it('draws info affordance', () => {
    const c = ctx()
    drawInfoAffordance(c, { x: 0, y: 0, width: 30, height: 20 }, '#f00')
    expect(c.fillText).toHaveBeenCalledWith('ⓘ', 22, 14)
  })
  it('draws highlighted column background', () => {
    const c = ctx()
    drawHighlightedColumnBackground(c, { x: 1, y: 2, width: 30, height: 40 }, '#ff0')
    expect(c.fillRect).toHaveBeenCalledWith(1, 2, 30, 40)
  })
})
