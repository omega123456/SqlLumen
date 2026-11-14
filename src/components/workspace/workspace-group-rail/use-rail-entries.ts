import { useEffect, useState } from 'react'
import type { WorkspaceTabStackGroup } from '../../../lib/workspace-tab-stacks'
import {
  RAIL_ITEM_TRANSITION_MS,
  groupsSignature,
  initialEntries,
  mergeEntries,
  settleEntries,
  type RailEntry,
} from './group-rail-model'

export function useRailEntries(stackGroups: WorkspaceTabStackGroup[]): RailEntry[] {
  const [entries, setEntries] = useState<RailEntry[]>(() => initialEntries(stackGroups))
  const [signature, setSignature] = useState(() => groupsSignature(stackGroups))
  const nextSignature = groupsSignature(stackGroups)
  if (nextSignature !== signature) {
    setSignature(nextSignature)
    setEntries(mergeEntries(entries, stackGroups))
  }

  useEffect(() => {
    if (entries.every((entry) => entry.phase === 'idle')) return
    const timer = window.setTimeout(() => {
      setEntries(settleEntries)
    }, RAIL_ITEM_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [entries])

  return entries
}
