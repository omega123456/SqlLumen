import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useEffect,
  type ReactNode,
} from 'react'
import type { PlainRange } from './diff-overlay-utils'

export type AiDiffHandler = (proposedSql: string, range: PlainRange) => void

interface AiDiffBridgeValue {
  registerHandler: (tabId: string, handler: AiDiffHandler | null) => void
  triggerDiff: (tabId: string, proposedSql: string, range: PlainRange) => void
}

const AiDiffBridgeContext = createContext<AiDiffBridgeValue | null>(null)

export function AiDiffBridgeProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef<Record<string, AiDiffHandler>>({})

  const registerHandler = useCallback((tabId: string, handler: AiDiffHandler | null) => {
    if (handler === null) {
      delete handlersRef.current[tabId]
      return
    }
    handlersRef.current[tabId] = handler
  }, [])

  const triggerDiff = useCallback((tabId: string, proposedSql: string, range: PlainRange) => {
    const handler = handlersRef.current[tabId]
    if (handler) {
      handler(proposedSql, range)
    }
  }, [])

  const value = useMemo(() => ({ registerHandler, triggerDiff }), [registerHandler, triggerDiff])

  return <AiDiffBridgeContext.Provider value={value}>{children}</AiDiffBridgeContext.Provider>
}

export function useRegisterAiDiffHandler(tabId: string, handler: AiDiffHandler | undefined) {
  const context = useContext(AiDiffBridgeContext)
  useEffect(() => {
    if (!context) return
    if (!handler) return
    context.registerHandler(tabId, handler)
    return () => {
      context.registerHandler(tabId, null)
    }
  }, [context, tabId, handler])
}

export function useAiDiffTrigger(): (
  tabId: string,
  proposedSql: string,
  range: PlainRange
) => void {
  const context = useContext(AiDiffBridgeContext)
  if (!context) {
    return () => {}
  }
  return context.triggerDiff
}
