import { useEffect, useState } from 'react'

/** Attribute TreeNode sets on each top-level database section. */
const SECTION_SELECTOR = '[data-database-section]'

/**
 * Return the id of the database section whose sticky row is currently pinned,
 * or null. A section is pinned when it is expanded, its top has scrolled above
 * the container's top edge, and some of it is still in view.
 */
export function findPinnedDatabaseSection(container: HTMLElement): string | null {
  const containerTop = container.getBoundingClientRect().top
  const sections = container.querySelectorAll<HTMLElement>(SECTION_SELECTOR)

  for (const section of sections) {
    if (!section.querySelector('[role="group"]')) continue
    const rect = section.getBoundingClientRect()
    if (rect.top < containerTop - 0.5 && rect.bottom > containerTop + 1) {
      return section.dataset.databaseSection ?? null
    }
  }

  return null
}

/**
 * Track which top-level database row is pinned to the top of a scrolling tree.
 * Recomputes on scroll (once per frame) and whenever the tree's rows change,
 * which covers expand, collapse, lazy loads and filtering.
 */
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
