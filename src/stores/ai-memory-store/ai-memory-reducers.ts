import type { AiMemoryState, ReembedStatus } from '../ai-memory-store'

type ReembedStatuses = Pick<AiMemoryState, 'reembedStatus'>

export interface OwnerReembedStatus {
  ownerKey: string
  status: ReembedStatus
}

export function putReembedStatus(
  state: ReembedStatuses,
  { ownerKey, status }: OwnerReembedStatus
): ReembedStatuses {
  return { reembedStatus: { ...state.reembedStatus, [ownerKey]: status } }
}
