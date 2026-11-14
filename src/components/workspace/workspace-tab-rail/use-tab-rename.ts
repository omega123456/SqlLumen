import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { WorkspaceTab } from '../../../types/schema'
import { useWorkspaceStore } from '../../../stores/workspace-store'

interface TabRenameInputs {
  connectionId: string
  tabs: WorkspaceTab[]
  onRequestRenameTab?: (tabId: string) => void
  restoreFocusAfterAction: (invokerTabId: string | null) => void
}

interface RenameSession {
  tabId: string | null
  draft: string
}

const IDLE_RENAME: RenameSession = { tabId: null, draft: '' }

const RENAME_KEY_COMMITS: Record<string, boolean> = { Enter: true, Escape: false }

export interface TabRename {
  renamingTabId: string | null
  renameDraft: string
  setRenameDraft: (draft: string) => void
  startRename: (tabId: string) => void
  handleRenameBlur: (tabId: string) => void
  handleRenameKeyDown: (tabId: string, event: KeyboardEvent<HTMLInputElement>) => void
}

export function useTabRename(inputs: TabRenameInputs) {
  const { connectionId, tabs, onRequestRenameTab, restoreFocusAfterAction } = inputs
  const renameQueryTab = useWorkspaceStore((state) => state.renameQueryTab)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const skipNextRenameBlurCommitRef = useRef(false)
  const [session, setSession] = useState<RenameSession>(IDLE_RENAME)

  useEffect(() => {
    const renameInput = renameInputRef.current
    if (!session.tabId) return
    if (!renameInput) return
    renameInput.focus()
    renameInput.select()
  }, [session.tabId])

  const startRename = (tabId: string) => {
    const tab = tabs.find((candidate) => candidate.id === tabId)
    if (!tab) return
    if (tab.type !== 'query-editor') return
    setSession({ tabId: tabId, draft: tab.label })
    onRequestRenameTab?.(tabId)
  }

  const stopRename = (invokerTabId: string | null, shouldCommit: boolean) => {
    const { tabId: targetTabId, draft } = session
    setSession(IDLE_RENAME)
    if (shouldCommit && targetTabId) renameQueryTab(connectionId, targetTabId, draft)
    restoreFocusAfterAction(invokerTabId)
  }

  const handleRenameBlur = (tabId: string) => {
    if (skipNextRenameBlurCommitRef.current) {
      skipNextRenameBlurCommitRef.current = false
      return
    }
    stopRename(tabId, true)
  }

  const handleRenameKeyDown = (tabId: string, event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    const shouldCommit = RENAME_KEY_COMMITS[event.key]
    if (shouldCommit === undefined) return
    event.preventDefault()
    skipNextRenameBlurCommitRef.current = true
    stopRename(tabId, shouldCommit)
  }

  const rename: TabRename = {
    renamingTabId: session.tabId,
    renameDraft: session.draft,
    setRenameDraft: (draft) => setSession((current) => ({ ...current, draft: draft })),
    startRename: startRename,
    handleRenameBlur: handleRenameBlur,
    handleRenameKeyDown: handleRenameKeyDown,
  }
  return { rename, renameInputRef }
}
