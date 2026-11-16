type StatusListener = () => void

const highlightedVersions = new Map<string, number>()
const statusListeners = new Set<StatusListener>()

function notifyStatusListeners(): void {
  for (const listener of statusListeners) {
    listener()
  }
}

export interface ModelVersion {
  uri: string
  versionId: number
}

export function onSemanticHighlightingStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function isSemanticHighlightingApplied(modelVersion: ModelVersion): boolean {
  return highlightedVersions.get(modelVersion.uri) === modelVersion.versionId
}

export function markSemanticHighlightingApplied(modelVersion: ModelVersion): void {
  highlightedVersions.set(modelVersion.uri, modelVersion.versionId)
  notifyStatusListeners()
}

export function clearSemanticHighlightingStatus(modelUri: string): void {
  const wasHighlighted = highlightedVersions.delete(modelUri)
  if (!wasHighlighted) return
  notifyStatusListeners()
}
