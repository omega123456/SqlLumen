export const QUERY_CANCELLED_MESSAGE = 'Query cancelled by user'

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function describeQueryFailure(wasCancelled: boolean, error: unknown): string {
  if (wasCancelled) return QUERY_CANCELLED_MESSAGE
  return toErrorMessage(error)
}
