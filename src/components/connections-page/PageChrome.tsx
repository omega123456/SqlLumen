import type { ReactNode } from 'react'
import { ArrowLeft } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { useConnectionStore } from '../../stores/connection-store'
import { useConnectionsPageStore } from '../../stores/connections-page-store'
import { PAGE_ICON_SIZE } from './page-icons'

export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-connections-page flex-1 flex-col gap-8 px-10 pt-8 pb-16">
      {children}
    </div>
  )
}

export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="-mb-4 flex">
      <Button variant="subtle" onClick={onClick}>
        <ArrowLeft size={PAGE_ICON_SIZE} aria-hidden className="shrink-0" />
        {label}
      </Button>
    </div>
  )
}

function useActiveSessionName(): string | null {
  return useConnectionStore((state) => {
    const activeTabId = state.activeTabId
    if (!activeTabId) return null
    return state.activeConnections[activeTabId]?.profile.name ?? null
  })
}

export function BackToSession() {
  const sessionName = useActiveSessionName()
  const closePage = useConnectionsPageStore((state) => state.closePage)
  if (sessionName === null) return null
  return <BackButton label={`Back to ${sessionName}`} onClick={closePage} />
}
