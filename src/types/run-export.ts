export type RunPhase = 'queued' | 'running' | 'writing'

export interface RunExportProgress {
  runFilePath: string
  phase: RunPhase
  statementNumber: number
  statementCount: number
  rowsWritten: number
  bytesWritten: number
}

export type RunOutcome =
  | { kind: 'complete' }
  | { kind: 'cancelled'; statementNumber: number }
  | { kind: 'stopped'; statementNumber: number }
  | { kind: 'writeFailed'; statementNumber: number; fileName: string }
  | { kind: 'failed'; message: string }

export interface RunExportSummary {
  runFilePath: string
  statementCount: number
  outcome: RunOutcome
}

export interface RunExportOptions {
  runId: string
}
