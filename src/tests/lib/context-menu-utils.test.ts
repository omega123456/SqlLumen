import { describe, it, expect, vi } from 'vitest'
import {
  clampContextMenuPosition,
  getContextMenuPortalRoot,
  isEditableFieldElement,
  isInsideDisabledTextControl,
  positionContextMenuInPortal,
  readClipboardText,
  resolveEditableFieldFromTarget,
  writeClipboardText,
} from '../../lib/context-menu-utils'

describe('clampContextMenuPosition', () => {
  it('keeps position when menu fits', () => {
    expect(clampContextMenuPosition(10, 20, 100, 50, 800, 600)).toEqual({ x: 10, y: 20 })
  })

  it('shifts left when overflowing viewport width', () => {
    expect(clampContextMenuPosition(300, 10, 200, 40, 320, 240)).toEqual({ x: 116, y: 10 })
  })

  it('shifts up when overflowing viewport height', () => {
    expect(clampContextMenuPosition(10, 220, 100, 40, 320, 240)).toEqual({ x: 10, y: 196 })
  })
})

describe('resolveEditableFieldFromTarget / isEditableFieldElement', () => {
  it('resolves text input and textarea', () => {
    const input = document.createElement('input')
    input.type = 'text'
    const ta = document.createElement('textarea')

    expect(resolveEditableFieldFromTarget(input)).toBe(input)
    expect(isEditableFieldElement(input)).toBe(true)
    expect(resolveEditableFieldFromTarget(ta)).toBe(ta)
    expect(isEditableFieldElement(ta)).toBe(true)
  })

  it('ignores disabled and non-text input types', () => {
    const disabled = document.createElement('input')
    disabled.type = 'text'
    disabled.disabled = true

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'

    expect(resolveEditableFieldFromTarget(disabled)).toBeNull()
    expect(resolveEditableFieldFromTarget(checkbox)).toBeNull()
  })

  it('resolves contenteditable host', () => {
    const host = document.createElement('div')
    host.setAttribute('contenteditable', 'true')
    const text = document.createTextNode('hi')
    host.appendChild(text)

    expect(resolveEditableFieldFromTarget(text)).toBe(host)
    expect(isEditableFieldElement(text)).toBe(true)
  })

  it('resolves plaintext-only contenteditable', () => {
    const host = document.createElement('div')
    host.setAttribute('contenteditable', 'plaintext-only')
    expect(resolveEditableFieldFromTarget(host)).toBe(host)
  })
})

describe('isInsideDisabledTextControl', () => {
  it('returns false for non-Element targets', () => {
    expect(isInsideDisabledTextControl(null)).toBe(false)
    expect(isInsideDisabledTextControl(document.createTextNode('x'))).toBe(false)
  })

  it('returns true inside a disabled input', () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.disabled = true
    expect(isInsideDisabledTextControl(input)).toBe(true)
  })
})

describe('getContextMenuPortalRoot', () => {
  it('returns document.body when there is no open dialog ancestor', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    expect(getContextMenuPortalRoot(div)).toBe(document.body)
    document.body.removeChild(div)
  })

  it('returns the open dialog when anchor is inside it', () => {
    const dlg = document.createElement('dialog')
    dlg.setAttribute('open', '')
    const inner = document.createElement('div')
    dlg.appendChild(inner)
    document.body.appendChild(dlg)
    expect(getContextMenuPortalRoot(inner)).toBe(dlg)
    document.body.removeChild(dlg)
  })
})

describe('positionContextMenuInPortal', () => {
  it('uses viewport clamping when portal is document.body', () => {
    const innerWidth = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320)
    const innerHeight = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(240)
    expect(positionContextMenuInPortal(document.body, 300, 200, 280, 40)).toEqual({ x: 36, y: 196 })
    innerWidth.mockRestore()
    innerHeight.mockRestore()
  })

  it('converts viewport pointer to local coords inside a dialog', () => {
    const dlg = document.createElement('dialog')
    vi.spyOn(dlg, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 80,
      width: 500,
      height: 400,
      top: 80,
      left: 100,
      right: 600,
      bottom: 480,
      toJSON: () => '',
    } as DOMRect)

    // Viewport click (250, 200) → local (150, 120); menu 100×40 fits without clamp shift
    expect(positionContextMenuInPortal(dlg, 250, 200, 100, 40)).toEqual({ x: 150, y: 120 })
  })
})

describe('clipboard helpers', () => {
  it('writeClipboardText throws when clipboard API is missing', async () => {
    const prev = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: undefined, readText: undefined },
    })
    await expect(writeClipboardText('x')).rejects.toThrow('Clipboard unavailable')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: prev })
  })

  it('readClipboardText throws when clipboard API is missing', async () => {
    const prev = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(), readText: undefined },
    })
    await expect(readClipboardText()).rejects.toThrow('Clipboard unavailable')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: prev })
  })
})
