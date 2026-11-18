import { formatDistanceToNowStrict, parseISO } from 'date-fns'

export const NEVER_CONNECTED_LABEL = 'Never connected'

export function lastConnectedLabel(lastConnectedAt: string | null): string {
  if (lastConnectedAt === null) return NEVER_CONNECTED_LABEL
  return formatDistanceToNowStrict(parseISO(lastConnectedAt), { addSuffix: true })
}
