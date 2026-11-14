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

  it('is false for outside nodes, non-nodes and a missing container', () => {
    const container = document.createElement('div')
    const outside = document.createElement('span')
    expect(isTargetInside(container, outside)).toBe(false)
    expect(isTargetInside(container, null)).toBe(false)
    expect(isTargetInside(null, outside)).toBe(false)
  })
})

describe('isTargetOutside', () => {
  it('is true for nodes and non-nodes outside a mounted container', () => {
    const container = document.createElement('div')
    const outside = document.createElement('span')
    expect(isTargetOutside(container, outside)).toBe(true)
    expect(isTargetOutside(container, null)).toBe(true)
  })

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

  it('is false for Shift+Enter and other keys', () => {
    expect(isPlainEnterKey({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(isPlainEnterKey({ key: 'a', shiftKey: false })).toBe(false)
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

  it('rejects other keys', () => {
    expect(isActivationKey('Escape')).toBe(false)
    expect(isActivationKey('a')).toBe(false)
  })
})

describe('isContextMenuKey', () => {
  it('accepts the ContextMenu key and Shift+F10', () => {
    expect(isContextMenuKey({ key: 'ContextMenu', shiftKey: false })).toBe(true)
    expect(isContextMenuKey({ key: 'F10', shiftKey: true })).toBe(true)
  })

  it('rejects F10 without Shift and other keys', () => {
    expect(isContextMenuKey({ key: 'F10', shiftKey: false })).toBe(false)
    expect(isContextMenuKey({ key: 'Enter', shiftKey: true })).toBe(false)
  })
})

describe('isInteractiveElement', () => {
  it('accepts form controls, links and contenteditable elements', () => {
    expect(isInteractiveElement(document.createElement('button'))).toBe(true)
    expect(isInteractiveElement(document.createElement('input'))).toBe(true)
    expect(isInteractiveElement(document.createElement('a'))).toBe(true)
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(isInteractiveElement(editable)).toBe(true)
  })

  it('rejects plain elements and non-elements', () => {
    expect(isInteractiveElement(document.createElement('div'))).toBeFalsy()
    expect(isInteractiveElement(null)).toBe(false)
    expect(isInteractiveElement(window)).toBe(false)
  })
})
