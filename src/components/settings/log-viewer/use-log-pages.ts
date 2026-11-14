import { useCallback, useEffect, useRef, useState } from 'react'
import { logFrontend } from '../../../lib/app-log-commands'
import { type LogEntry, type LogLevelFilter, listLogs } from '../../../lib/log-commands'
import { toErrorMessage } from '../../../lib/error-message'

export const LOG_PAGE_SIZE = 20
const AUTO_REFRESH_MS = 5000

export interface LogPageRequest {
  page: number
  level: LogLevelFilter
  refreshOnly: boolean
}

interface LoadedLogPage {
  entries: LogEntry[]
  total: number
}

const EMPTY_LOG_PAGE: LoadedLogPage = { entries: [], total: 0 }

function useLogPageLoader(setPage: (page: number) => void) {
  const [loaded, setLoaded] = useState<LoadedLogPage>(EMPTY_LOG_PAGE)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const loadPage = useCallback(
    async ({ page, level, refreshOnly }: LogPageRequest) => {
      const requestId = ++requestIdRef.current
      const isCurrentRequest = () => requestId === requestIdRef.current
      const setBusy = refreshOnly ? setIsRefreshing : setIsLoading
      setBusy(true)
      try {
        const response = await listLogs(page, level)
        if (!isCurrentRequest()) return
        setLoaded({ entries: response.entries, total: response.total })
        if (!refreshOnly) setPage(response.page)
        setErrorMessage(null)
      } catch (error) {
        if (!isCurrentRequest()) return
        const message = toErrorMessage(error)
        setErrorMessage(message)
        logFrontend('error', `[log-viewer] Failed to load logs: ${message}`)
      } finally {
        if (isCurrentRequest()) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    },
    [setPage]
  )

  return { ...loaded, isLoading, isRefreshing, errorMessage, loadPage }
}

export function useLogPages() {
  const [page, setPage] = useState(1)
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>('all')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const loader = useLogPageLoader(setPage)
  const { loadPage } = loader

  useEffect(() => {
    void loadPage({ page: page, level: levelFilter, refreshOnly: false })
  }, [loadPage, page, levelFilter])

  useEffect(() => {
    if (!autoRefresh) return
    const intervalId = window.setInterval(() => {
      void loadPage({ page: page, level: levelFilter, refreshOnly: true })
    }, AUTO_REFRESH_MS)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [autoRefresh, loadPage, page, levelFilter])

  const changeLevel = useCallback((level: LogLevelFilter) => {
    setPage(1)
    setLevelFilter(level)
  }, [])
  const refresh = () => void loadPage({ page: page, level: levelFilter, refreshOnly: true })
  const toggleAutoRefresh = () => setAutoRefresh((value) => !value)

  return {
    ...loader,
    page,
    setPage,
    levelFilter,
    changeLevel,
    autoRefresh,
    toggleAutoRefresh,
    refresh,
  }
}

export type LogPages = ReturnType<typeof useLogPages>
