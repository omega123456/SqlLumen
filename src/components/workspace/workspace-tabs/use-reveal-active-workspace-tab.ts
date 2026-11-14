import { useEffect, useRef } from 'react'
import type { WorkspaceTabStackKey } from '../../../lib/workspace-tab-stacks'

interface RevealInputs {
  activeTabId: string | null
  connectionActive: boolean
  shownStackKey: WorkspaceTabStackKey | null
}

export function useRevealActiveWorkspaceTab({
  activeTabId,
  connectionActive,
  shownStackKey,
}: RevealInputs) {
  const memberRowRef = useRef<HTMLDivElement | null>(null)
  const revealedTabIdRef = useRef<string | null>(null)
  useEffect(() => {
    void shownStackKey
    if (activeTabId === revealedTabIdRef.current) return
    if (!activeTabId) {
      revealedTabIdRef.current = activeTabId
      return
    }
    const isHiddenConnectionWorkspace = !connectionActive
    if (isHiddenConnectionWorkspace) return
    revealedTabIdRef.current = activeTabId
    const tabElement = memberRowRef.current?.querySelector<HTMLElement>(
      `[data-testid="workspace-tab-${activeTabId}"]`
    )
    tabElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, connectionActive, shownStackKey])
  return memberRowRef
}
