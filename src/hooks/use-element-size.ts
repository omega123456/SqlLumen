import { useLayoutEffect, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

const ZERO_SIZE: ElementSize = { width: 0, height: 0 }

export function useElementSize(ref: React.RefObject<HTMLElement | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>(ZERO_SIZE)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size
}
