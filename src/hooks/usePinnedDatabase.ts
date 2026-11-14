import { useEffect, useState } from 'react'

const SECTION_SELECTOR = '[data-database-section]'
const SUBPIXEL_SCROLL_TOLERANCE_PX = 0.5

export function findPinnedDatabaseSection(container: HTMLElement): string | null {
  const containerTop = container.getBoundingClientRect().top
  const sections = container.querySelectorAll<HTMLElement>(SECTION_SELECTOR)

  for (const section of sections) {
    if (!section.querySelector('[role="group"]')) continue
    const rect = section.getBoundingClientRect()
    const isScrolledUnderContainerTop =
      rect.top < containerTop - SUBPIXEL_SCROLL_TOLERANCE_PX && rect.bottom > containerTop + 1
    if (isScrolledUnderContainerTop) {
      return section.dataset.databaseSection ?? null
    }
  }

  return null
}

export function usePinnedDatabase(container: HTMLElement | null): string | null {
  const [pinnedId, setPinnedId] = useState<string | null>(null)

  useEffect(() => {
    if (!container) return undefined

    let frame: number | null = null

    const update = () => {
      frame = null
      setPinnedId(findPinnedDatabaseSection(container))
    }

    const schedule = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(update)
    }

    schedule()
    container.addEventListener('scroll', schedule, { passive: true })

    const observer = new MutationObserver(schedule)
    observer.observe(container, { childList: true, subtree: true })

    return () => {
      container.removeEventListener('scroll', schedule)
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [container])

  return container ? pinnedId : null
}
