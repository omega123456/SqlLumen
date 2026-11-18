import { Activity, useState, type ReactNode } from 'react'

interface RetainedViewProps {
  isVisible: boolean
  children: ReactNode
}

function useHasBeenVisible(isVisible: boolean): boolean {
  const [hasBeenVisible, setHasBeenVisible] = useState(isVisible)
  const isFirstReveal = isVisible && !hasBeenVisible
  if (isFirstReveal) setHasBeenVisible(true)
  return hasBeenVisible || isVisible
}

export function RetainedView({ isVisible, children }: RetainedViewProps) {
  const hasBeenVisible = useHasBeenVisible(isVisible)
  if (!hasBeenVisible) return null
  return <Activity mode={isVisible ? 'visible' : 'hidden'}>{children}</Activity>
}
