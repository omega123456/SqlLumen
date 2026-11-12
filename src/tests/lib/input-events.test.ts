import { describe, expect, it } from 'vitest'
import {
  isActivationKey,
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
