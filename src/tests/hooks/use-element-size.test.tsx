import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { useElementSize } from '../../hooks/use-element-size'

let resizeCallback: ResizeObserverCallback | null = null

class TestResizeObserver implements ResizeObserver {
  observe = () => {}
  unobserve = () => {}
  disconnect = () => {}
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback
  }
}

function SizeProbe({ withElement = true }: { withElement?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const size = useElementSize(ref)
  return withElement ? (
    <div ref={ref}>{`${size.width}x${size.height}`}</div>
  ) : (
    <div>{`${size.width}x${size.height}`}</div>
  )
}

describe('useElementSize', () => {
  it('returns zero initially', () => {
    globalThis.ResizeObserver = TestResizeObserver
    render(<SizeProbe />)
    expect(screen.getByText('0x0')).toBeInTheDocument()
  })

  it('updates after ResizeObserver fires', () => {
    globalThis.ResizeObserver = TestResizeObserver
    render(<SizeProbe />)
    act(() => {
      resizeCallback?.(
        [{ contentRect: { width: 123, height: 45 } } as ResizeObserverEntry],
        {} as ResizeObserver
      )
    })
    expect(screen.getByText('123x45')).toBeInTheDocument()
  })

  it('handles null ref gracefully', () => {
    globalThis.ResizeObserver = TestResizeObserver
    render(<SizeProbe withElement={false} />)
    expect(screen.getByText('0x0')).toBeInTheDocument()
  })
})
