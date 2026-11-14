import type { RefObject } from 'react'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import {
  getWorkspaceStackActivationTarget,
  type WorkspaceTabStackKey,
} from '../../../lib/workspace-tab-stacks'
import { focusWorkspaceTab } from '../workspace-tab-rail/tab-rail-model'
import { stackTabsFor } from './workspace-tabs-model'
import type { WorkspaceStacks } from './use-workspace-stacks'

const EMPTY_STACK_RECENCY = {}

interface StackActivationInputs {
  connectionId: string
  hideTableDataTabs: boolean
  stacks: WorkspaceStacks
  workspaceRootRef: RefObject<HTMLDivElement | null>
}

export function useStackActivation(inputs: StackActivationInputs) {
  const { connectionId, hideTableDataTabs, stacks, workspaceRootRef } = inputs
  const requestActivateTab = useWorkspaceStore((state) => state.requestActivateTab)
  const stackRecency: Partial<Record<WorkspaceTabStackKey, string>> = useWorkspaceStore(
    (state) => state.stackRecencyByConnection[connectionId] ?? EMPTY_STACK_RECENCY
  )

  const activationTargetFor = (stackKey: WorkspaceTabStackKey) =>
    getWorkspaceStackActivationTarget({
      stackKey: stackKey,
      tabs: stacks.visibleNonPinnedTabs,
      recentTabId: stackRecency[stackKey] ?? null,
      options: { hideScopedTableDataTabs: hideTableDataTabs },
    })

  const activateStack = (stackKey: WorkspaceTabStackKey | null) => {
    if (!stackKey) return
    const target = activationTargetFor(stackKey)
    if (!target) return
    requestActivateTab(target.id)
  }

  const focusStackMembers = (stackKey: WorkspaceTabStackKey) => {
    const firstStackTabId = stackTabsFor(stacks.stackGroups, stackKey)[0]?.id
    const targetTabId = activationTargetFor(stackKey)?.id ?? firstStackTabId
    if (!targetTabId) return
    if (stacks.activeTabId !== targetTabId) requestActivateTab(targetTabId)
    requestAnimationFrame(() => {
      focusWorkspaceTab(workspaceRootRef.current, targetTabId)
    })
  }

  return { activateStack, focusStackMembers, requestActivateTab }
}
