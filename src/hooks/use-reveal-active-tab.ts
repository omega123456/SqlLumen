import { useCallback, useEffect, useRef } from 'react'

const TABLIST_SELECTOR = '[role="tablist"]'

function isFocusInsideTablist(tab: HTMLElement): boolean {
  const tablist = tab.closest(TABLIST_SELECTOR)
  return tablist?.contains(document.activeElement) ?? false
}

export interface RevealedTabStrip {
  registerTab: (index: number, element: HTMLButtonElement | null) => void
  focusedTabIndex: () => number
}

export function useRevealActiveTab(activeIndex: number): RevealedTabStrip {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const activeTab = activeIndex >= 0 ? tabRefs.current[activeIndex] : null
    if (!activeTab) return
    activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (isFocusInsideTablist(activeTab)) activeTab.focus()
  }, [activeIndex])

  const registerTab = useCallback((index: number, element: HTMLButtonElement | null) => {
    tabRefs.current[index] = element
  }, [])

  const focusedTabIndex = useCallback(
    () => tabRefs.current.findIndex((tab) => tab === document.activeElement),
    []
  )

  return { registerTab, focusedTabIndex }
}
