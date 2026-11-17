import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { expectToast, ipc } from '../../ipc-mock'
import { windowedItem } from '../../helpers/query-test-utils'
import { useQueryStore } from '../../../stores/query-store'
import { useToastStore } from '../../../stores/toast-store'
import type { MultiQueryResult } from '../../../types/schema'
import type { RunExportProgress, RunOutcome } from '../../../types/run-export'

const TARGET = {
  connectionId: 'conn-1',
  tabId: 'tab-1',
  statements: ['SELECT 1', 'SELECT missing', 'DROP TABLE t'],
}
const RUN_FILE_PATH = '/tmp/sqllumen/agent-runs/run-2/run.md'
const PROGRESS: RunExportProgress = {
  runFilePath: RUN_FILE_PATH,
  phase: 'writing',
  statementNumber: 1,
  statementCount: 3,
  rowsWritten: 120_000,
  bytesWritten: 4_096,
}

const TRUNCATED_RUN_ITEM = windowedItem({
  queryId: 'q1',
  columns: [{ name: 'n', dataType: 'BIGINT' }],
  totalRows: 100_000,
  exportedRowCount: 2_345_678,
})

function runResult(outcome: RunOutcome): MultiQueryResult {
  return {
    results: [TRUNCATED_RUN_ITEM],
    runExport: { runFilePath: RUN_FILE_PATH, statementCount: 3, outcome: outcome },
  }
}

function deferredRun() {
  let resolveRun: (result: MultiQueryResult) => void = () => {}
  ipc.override(
    'execute_multi_query',
    () => new Promise<MultiQueryResult>((resolve) => (resolveRun = resolve))
  )
  return (result: MultiQueryResult) => resolveRun(result)
}

function startRunAt(runFilePath: string) {
  ipc.override('start_run_export', () => ({ runId: 'run-2', runFilePath: runFilePath }))
}

async function runAndCopy() {
  await act(async () => {
    await useQueryStore.getState().executeAllAndCopyResultPath(TARGET)
  })
}

function tabRunExport() {
  return useQueryStore.getState().tabs['tab-1']?.runExport
}

function toastTitles(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.title)
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  useToastStore.setState({ toasts: [] })
  startRunAt(RUN_FILE_PATH)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('executeAllAndCopyResultPath', () => {
  it('copies the path at start, polls progress and keeps the outcome toast until dismissed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    ipc.override('get_run_export_progress', () => PROGRESS)
    const clipboardWrite = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const finishRun = deferredRun()
    let running: Promise<void> = Promise.resolve()

    await act(async () => {
      running = useQueryStore.getState().executeAllAndCopyResultPath(TARGET)
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(clipboardWrite).toHaveBeenCalledWith(RUN_FILE_PATH)
    await expectToast('success', 'Run started, path copied')
    expect(ipc.payloads('execute_multi_query')[0]).toMatchObject({
      statements: TARGET.statements,
      runExport: { runId: 'run-2' },
    })
    expect(tabRunExport()).toMatchObject({ runId: 'run-2', isActive: true, progress: null })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(tabRunExport()?.progress).toEqual(PROGRESS)

    await act(async () => {
      finishRun(runResult({ kind: 'complete' }))
      await running
    })

    expect(tabRunExport()).toMatchObject({ isActive: false, runFilePath: RUN_FILE_PATH })
    const completeToast = useToastStore
      .getState()
      .toasts.find((toast) => toast.title === 'Run complete')
    expect(completeToast?.message).toBe(`1 result set · 2,345,678 rows · ${RUN_FILE_PATH}`)
    expect(completeToast?.durationMs).toBeNull()
    const callsAfterFinish = ipc.calls('get_run_export_progress').length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(ipc.calls('get_run_export_progress')).toHaveLength(callsAfterFinish)

    await act(async () => {
      await useQueryStore.getState().copyLastRunFilePath('tab-1')
    })
    await expectToast('success', RUN_FILE_PATH)
  })

  it('shows one toast when a running export is cancelled', async () => {
    ipc.override('cancel_query', () => true)
    const finishRun = deferredRun()
    let running: Promise<void> = Promise.resolve()
    await act(async () => {
      running = useQueryStore.getState().executeAllAndCopyResultPath(TARGET)
    })

    await act(async () => {
      await useQueryStore.getState().cancelQuery('conn-1', 'tab-1')
      finishRun(runResult({ kind: 'cancelled', statementNumber: 1 }))
      await running
    })

    await expectToast('warning', 'Run cancelled at statement 1 of 3')
    await expectToast('warning', `Result 1 is incomplete. Run file: ${RUN_FILE_PATH}`)
    expect(toastTitles()).not.toContain('Query cancelled')
  })

  it.each<[RunOutcome, 'warning' | 'error', string]>([
    [{ kind: 'stopped', statementNumber: 2 }, 'warning', 'Run stopped at statement 2 of 3'],
    [
      { kind: 'writeFailed', statementNumber: 2, fileName: 'result-2.csv' },
      'error',
      "Run stopped: couldn't write result 2",
    ],
    [{ kind: 'failed', message: "Couldn't write the run file" }, 'warning', 'Run failed'],
  ])('reports the %o outcome', async (outcome, variant, title) => {
    ipc.override('execute_multi_query', () => runResult(outcome))

    await runAndCopy()

    await expectToast(variant, title)
  })

  it('reports a run that failed or was cancelled before any results came back', async () => {
    ipc.override('execute_multi_query', () => {
      throw new Error('Lost connection to server')
    })

    await runAndCopy()

    await expectToast('warning', 'Run failed')

    ipc.override('cancel_query', () => true)
    let rejectRun: (error: Error) => void = () => {}
    ipc.override(
      'execute_multi_query',
      () => new Promise((_resolve, reject) => (rejectRun = reject))
    )
    let running: Promise<void> = Promise.resolve()
    await act(async () => {
      running = useQueryStore.getState().executeAllAndCopyResultPath(TARGET)
    })
    await act(async () => {
      await useQueryStore.getState().cancelQuery('conn-1', 'tab-1')
      rejectRun(new Error('Query cancelled while waiting for the editor session'))
      await running
    })

    await expectToast('warning', 'Run cancelled at statement 1 of 3')
  })

  it('shows the path to copy by hand when the clipboard refuses it', async () => {
    ipc.override('plugin:clipboard-manager|write-text', () => {
      throw new Error('clipboard denied')
    })
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))

    await runAndCopy()

    await expectToast('warning', `Copy this path manually: ${RUN_FILE_PATH}`)
    expect(toastTitles()).not.toContain('Run started, path copied')
  })

  it('runs nothing when the run folder cannot be created', async () => {
    ipc.override('start_run_export', () => {
      throw new Error("Couldn't create the run folder: permission denied")
    })

    await runAndCopy()

    await expectToast('error', "Couldn't start the run")
    expect(ipc.calls('execute_multi_query')).toHaveLength(0)
    expect(tabRunExport() ?? null).toBeNull()
  })

  it.each([
    ['tab', () => useQueryStore.getState().cleanupTab('conn-1', 'tab-1')],
    ['connection', () => useQueryStore.getState().cleanupConnection('conn-1', ['tab-1'])],
  ])('stops polling and drops the run when its %s closes during a run', async (_, closeTab) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    deferredRun()
    await act(async () => {
      void useQueryStore.getState().executeAllAndCopyResultPath(TARGET)
      await vi.advanceTimersByTimeAsync(0)
    })

    act(closeTab)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(ipc.calls('get_run_export_progress')).toHaveLength(0)
    expect(useQueryStore.getState().tabs['tab-1']).toBeUndefined()
  })

  it('does nothing while the tab is already running, or with no run file to re-copy', async () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    act(() => {
      useQueryStore.setState((state) => ({
        tabs: { 'tab-1': { ...state.tabs['tab-1'], tabStatus: 'running' } },
      }))
    })

    await runAndCopy()
    await act(async () => {
      await useQueryStore.getState().copyLastRunFilePath('tab-1')
    })

    expect(ipc.calls('start_run_export')).toHaveLength(0)
    expect(useToastStore.getState().toasts).toEqual([])
  })
})
