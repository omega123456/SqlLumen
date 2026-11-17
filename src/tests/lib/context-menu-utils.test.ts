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
    expect(
      clampContextMenuPosition({
        requestedX: 10,
        requestedY: 20,
        menuWidth: 100,
        menuHeight: 50,
        viewportWidth: 800,
        viewportHeight: 600,
      })
    ).toEqual({ x: 10, y: 20 })
  })
})

describe('resolveEditableFieldFromTarget / isEditableFieldElement', () => {
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
})

describe('isInsideDisabledTextControl', () => {
  it('returns false for non-Element targets', () => {
    expect(isInsideDisabledTextControl(null)).toBe(false)
    expect(isInsideDisabledTextControl(document.createTextNode('x'))).toBe(false)
  })
})

describe('getContextMenuPortalRoot', () => {
  it('returns document.body when there is no open dialog ancestor', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    expect(getContextMenuPortalRoot(div)).toBe(document.body)
    document.body.removeChild(div)
  })
})

describe('positionContextMenuInPortal', () => {
  it('uses viewport clamping when portal is document.body', () => {
    const innerWidth = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320)
    const innerHeight = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(240)
    expect(
      positionContextMenuInPortal({
        portalRoot: document.body,
        clientX: 300,
        clientY: 200,
        menuWidth: 280,
        menuHeight: 40,
      })
    ).toEqual({ x: 36, y: 196 })
    innerWidth.mockRestore()
    innerHeight.mockRestore()
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
