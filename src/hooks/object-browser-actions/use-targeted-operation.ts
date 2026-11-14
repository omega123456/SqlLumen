import { useCallback, useState } from 'react'
import { showErrorToast } from '../../stores/toast-store'
import { toErrorMessage } from '../../lib/error-message'

export interface OperationSteps<Target> {
  perform: (target: Target) => Promise<void>
  afterSuccess: (target: Target) => Promise<void> | void
  failureTitle: (target: Target) => string
}

export interface TargetedOperation<Target> {
  target: Target | null
  isLoading: boolean
  error: string | null
  open: (target: Target) => void
  close: () => void
  run: (steps: OperationSteps<Target>) => Promise<void>
}

export function useTargetedOperation<Target>(): TargetedOperation<Target> {
  const [target, setTarget] = useState<Target | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback((nextTarget: Target) => {
    setTarget(nextTarget)
    setError(null)
    setIsLoading(false)
  }, [])

  const close = useCallback(() => setTarget(null), [])

  const run = useCallback(
    async ({ perform, afterSuccess, failureTitle }: OperationSteps<Target>) => {
      if (target === null) return
      setIsLoading(true)
      setError(null)
      try {
        await perform(target)
        setTarget(null)
        await afterSuccess(target)
      } catch (caughtError) {
        const message = toErrorMessage(caughtError)
        setError(message)
        showErrorToast(failureTitle(target), message)
      } finally {
        setIsLoading(false)
      }
    },
    [target]
  )

  return { target, isLoading, error, open, close, run }
}
