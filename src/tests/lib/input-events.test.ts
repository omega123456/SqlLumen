import { describe, expect, it } from 'vitest'
import {
  isActivationKey,
  isContextMenuKey,
  isInteractiveElement,
  isMiddleMouseButton,
  isTargetOutside,
  isPlainEnterKey,
  isTargetInside,
} from '../../lib/input-events'

describe('isTargetInside', () => {
  it('is true for a node inside the container', () => {
    const container = document.createElement('div')
    const child = document.createElement('span')
    container.appendChild(child)
    expect(isTargetInside(container, child)).toBe(true)
  })
})

describe('isTargetOutside', () => {
  it('is false inside the container and when the container is missing', () => {
    const container = document.createElement('div')
    const child = document.createElement('span')
    container.appendChild(child)
    expect(isTargetOutside(container, child)).toBe(false)
    expect(isTargetOutside(container, container)).toBe(false)
    expect(isTargetOutside(null, child)).toBe(false)
  })
})

describe('isPlainEnterKey', () => {
  it('is true for Enter without Shift', () => {
    expect(isPlainEnterKey({ key: 'Enter', shiftKey: false })).toBe(true)
  })
})

describe('isMiddleMouseButton', () => {
  it('is true only for the middle button', () => {
    expect(isMiddleMouseButton({ button: 1 })).toBe(true)
    expect(isMiddleMouseButton({ button: 0 })).toBe(false)
    expect(isMiddleMouseButton({ button: 2 })).toBe(false)
  })
})

describe('isActivationKey', () => {
  it('accepts Enter and Space', () => {
    expect(isActivationKey('Enter')).toBe(true)
    expect(isActivationKey(' ')).toBe(true)
  })
})

describe('isContextMenuKey', () => {
  it('accepts the ContextMenu key and Shift+F10', () => {
    expect(isContextMenuKey({ key: 'ContextMenu', shiftKey: false })).toBe(true)
    expect(isContextMenuKey({ key: 'F10', shiftKey: true })).toBe(true)
  })
})

describe('isInteractiveElement', () => {
  it('rejects plain elements and non-elements', () => {
    expect(isInteractiveElement(document.createElement('div'))).toBeFalsy()
    expect(isInteractiveElement(null)).toBe(false)
    expect(isInteractiveElement(window)).toBe(false)
  })
})
