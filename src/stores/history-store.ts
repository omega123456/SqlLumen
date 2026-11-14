import { create } from 'zustand'
import type { HistoryEntry, HistoryPage } from '../types/schema'
import {
  listHistory as listHistoryCmd,
  deleteHistoryEntry as deleteHistoryEntryCmd,
  clearHistory as clearHistoryCmd,
} from '../lib/history-commands'
import { showErrorToast, showSuccessToast } from './toast-store'

import { logFrontendError } from '../lib/app-log-commands'
import { toErrorMessage } from '../lib/error-message'

const DEFAULT_PAGE_SIZE = 50

export const HISTORY_SEARCH_DEBOUNCE_MS = 250

const searchDebounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}

const latestRequestSeq: Record<string, number> = {}

function nextRequestSeq(connectionId: string): number {
  const seq = (latestRequestSeq[connectionId] ?? 0) + 1
  latestRequestSeq[connectionId] = seq
  return seq
}

interface LoadHistoryOptions {
  page?: number
  search?: string
  since?: string | null
  append?: boolean
}

interface HistoryState {
  entriesByConnection: Record<string, HistoryEntry[]>
  totalByConnection: Record<string, number>
  pageByConnection: Record<string, number>
  searchByConnection: Record<string, string>
  sinceByConnection: Record<string, string | null>
  isLoadingByConnection: Record<string, boolean>
  isLoadingMoreByConnection: Record<string, boolean>
  errorByConnection: Record<string, string | null>
  pageSize: number

  loadHistory: (connectionId: string, options?: LoadHistoryOptions) => Promise<void>
  loadMore: (connectionId: string) => Promise<void>
  deleteEntry: (connectionId: string, id: number) => Promise<void>
  clearAll: (connectionId: string) => Promise<void>
  setSearch: (connectionId: string, search: string) => void
  setPage: (connectionId: string, page: number) => void
  reset: () => void
  notifyNewQuery: (connectionId: string) => void
}

const INITIAL_STATE = {
  entriesByConnection: {} as Record<string, HistoryEntry[]>,
  totalByConnection: {} as Record<string, number>,
  pageByConnection: {} as Record<string, number>,
  searchByConnection: {} as Record<string, string>,
  sinceByConnection: {} as Record<string, string | null>,
  isLoadingByConnection: {} as Record<string, boolean>,
  isLoadingMoreByConnection: {} as Record<string, boolean>,
  errorByConnection: {} as Record<string, string | null>,
  pageSize: DEFAULT_PAGE_SIZE,
}

interface HistoryQuery {
  append: boolean
  page: number
  search: string
  since: HistoryState['sinceByConnection'][string]
}

function resolveHistoryQuery(
  state: HistoryState,
  connectionId: string,
  options: LoadHistoryOptions
): HistoryQuery {
  const search =
    options.search !== undefined ? options.search : (state.searchByConnection[connectionId] ?? '')
  const since =
    options.since !== undefined ? options.since : (state.sinceByConnection[connectionId] ?? null)
  return {
    append: options.append ?? false,
    page: options.page ?? state.pageByConnection[connectionId] ?? 1,
    search: search,
    since: since,
  }
}

function markHistoryLoading(connectionId: string, append: boolean): void {
  const state = useHistoryStore.getState()
  if (append) {
    useHistoryStore.setState({
      isLoadingMoreByConnection: { ...state.isLoadingMoreByConnection, [connectionId]: true },
    })
    return
  }
  useHistoryStore.setState({
    isLoadingByConnection: { ...state.isLoadingByConnection, [connectionId]: true },
    errorByConnection: { ...state.errorByConnection, [connectionId]: null },
  })
}

function markHistoryLoadFailed(connectionId: string, append: boolean, message: string): void {
  const state = useHistoryStore.getState()
  if (append) {
    useHistoryStore.setState({
      isLoadingMoreByConnection: { ...state.isLoadingMoreByConnection, [connectionId]: false },
    })
    showErrorToast('Failed to load more history', message)
    return
  }
  useHistoryStore.setState({
    isLoadingByConnection: { ...state.isLoadingByConnection, [connectionId]: false },
    errorByConnection: { ...state.errorByConnection, [connectionId]: message },
  })
}

async function loadHistory(connectionId: string, options: LoadHistoryOptions = {}): Promise<void> {
  const { append, page, search, since } = resolveHistoryQuery(
    useHistoryStore.getState(),
    connectionId,
    options
  )
  const requestSeq = nextRequestSeq(connectionId)
  const isStale = () => latestRequestSeq[connectionId] !== requestSeq
  markHistoryLoading(connectionId, append)

  try {
    const result: HistoryPage = await listHistoryCmd({
      connectionId: connectionId,
      page: page,
      pageSize: useHistoryStore.getState().pageSize,
      search: search,
      since: since,
    })
    if (isStale()) return

    const previous = useHistoryStore.getState().entriesByConnection[connectionId] ?? []
    const entries = append ? [...previous, ...result.entries] : result.entries

    useHistoryStore.setState({
      entriesByConnection: {
        ...useHistoryStore.getState().entriesByConnection,
        [connectionId]: entries,
      },
      totalByConnection: {
        ...useHistoryStore.getState().totalByConnection,
        [connectionId]: result.total,
      },
      pageByConnection: { ...useHistoryStore.getState().pageByConnection, [connectionId]: page },
      searchByConnection: {
        ...useHistoryStore.getState().searchByConnection,
        [connectionId]: search,
      },
      sinceByConnection: { ...useHistoryStore.getState().sinceByConnection, [connectionId]: since },
      isLoadingByConnection: {
        ...useHistoryStore.getState().isLoadingByConnection,
        [connectionId]: false,
      },
      isLoadingMoreByConnection: {
        ...useHistoryStore.getState().isLoadingMoreByConnection,
        [connectionId]: false,
      },
    })
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontendError('[history-store] loadHistory failed:', error)
    if (isStale()) return
    markHistoryLoadFailed(connectionId, append, message)
  }
}

async function loadMore(connectionId: string): Promise<void> {
  const nextPage = (useHistoryStore.getState().pageByConnection[connectionId] ?? 1) + 1
  await useHistoryStore.getState().loadHistory(connectionId, { page: nextPage, append: true })
}

async function deleteEntry(connectionId: string, id: number): Promise<void> {
  try {
    await deleteHistoryEntryCmd(id)
    const state = useHistoryStore.getState()
    const page = state.pageByConnection[connectionId] ?? 1
    await useHistoryStore.getState().loadHistory(connectionId, { page })
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontendError('[history-store] deleteEntry failed:', error)
    showErrorToast('Failed to delete history entry', message)
  }
}

async function clearAll(connectionId: string): Promise<void> {
  try {
    const count = await clearHistoryCmd(connectionId)
    useHistoryStore.setState({
      entriesByConnection: {
        ...useHistoryStore.getState().entriesByConnection,
        [connectionId]: [],
      },
      totalByConnection: { ...useHistoryStore.getState().totalByConnection, [connectionId]: 0 },
      pageByConnection: { ...useHistoryStore.getState().pageByConnection, [connectionId]: 1 },
    })
    showSuccessToast('History cleared', `Removed ${count} entries`)
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontendError('[history-store] clearAll failed:', error)
    showErrorToast('Failed to clear history', message)
  }
}

function setSearch(connectionId: string, search: string): void {
  useHistoryStore.setState({
    searchByConnection: {
      ...useHistoryStore.getState().searchByConnection,
      [connectionId]: search,
    },
  })
  nextRequestSeq(connectionId)
  clearTimeout(searchDebounceTimers[connectionId])
  searchDebounceTimers[connectionId] = setTimeout(() => {
    delete searchDebounceTimers[connectionId]
    void useHistoryStore.getState().loadHistory(connectionId, { page: 1, search: search })
  }, HISTORY_SEARCH_DEBOUNCE_MS)
}

function setPage(connectionId: string, page: number): void {
  void useHistoryStore.getState().loadHistory(connectionId, { page })
}

function reset(): void {
  for (const connectionId of Object.keys(searchDebounceTimers)) {
    clearTimeout(searchDebounceTimers[connectionId])
    delete searchDebounceTimers[connectionId]
  }
  for (const connectionId of Object.keys(latestRequestSeq)) {
    nextRequestSeq(connectionId)
  }
  useHistoryStore.setState(INITIAL_STATE)
}

function notifyNewQuery(connectionId: string): void {
  const state = useHistoryStore.getState()
  if (connectionId in state.entriesByConnection) {
    void useHistoryStore.getState().loadHistory(connectionId, { page: 1 })
  }
}

export const useHistoryStore = create<HistoryState>()(() => ({
  ...INITIAL_STATE,
  loadHistory: loadHistory,
  loadMore: loadMore,
  deleteEntry: deleteEntry,
  clearAll: clearAll,
  setSearch: setSearch,
  setPage: setPage,
  reset: reset,
  notifyNewQuery: notifyNewQuery,
}))
