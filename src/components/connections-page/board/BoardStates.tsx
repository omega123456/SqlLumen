import type { ReactNode } from 'react'
import { Plus } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { InfoBar } from '../../common/InfoBar'
import { joinClassNames } from '../../../lib/class-names'
import { SHIMMER_BLOCK } from '../../../lib/class-names-skeleton'
import { PAGE_ICON_SIZE } from '../page-icons'

const SKELETON_TILE_COUNT = 4
const SKELETON_TILE_KEYS = Array.from({ length: SKELETON_TILE_COUNT }, (_, index) => index)

export function BoardSkeleton() {
  return (
    <ul className="grid grid-cols-connection-tiles gap-3" aria-busy data-testid="board-skeleton">
      {SKELETON_TILE_KEYS.map((key) => (
        <li
          key={key}
          className={joinClassNames([SHIMMER_BLOCK, 'h-connection-tile rounded-card'])}
        />
      ))}
    </ul>
  )
}

export function BoardLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <InfoBar
      severity="error"
      title="Saved connections could not be loaded"
      message={message}
      actions={<Button onClick={onRetry}>Retry</Button>}
    />
  )
}

function BoardMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-6">
      <h2 className="font-headline text-subtitle font-semibold text-light-on-surface dark:text-dark-on-surface">
        {title}
      </h2>
      {children}
    </div>
  )
}

export function BoardEmpty({ onNewConnection }: { onNewConnection: () => void }) {
  return (
    <BoardMessage title="No saved connections yet">
      <span className="text-body text-light-on-surface-variant dark:text-dark-on-surface-variant">
        Paste a connection URL above, or fill in a new connection by hand.
      </span>
      <Button variant="accent" onClick={onNewConnection}>
        <Plus size={PAGE_ICON_SIZE} aria-hidden className="shrink-0" />
        New connection
      </Button>
    </BoardMessage>
  )
}

export function BoardNoMatch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <BoardMessage title={`No servers match “${query}”`}>
      <Button onClick={onClear}>Clear filter</Button>
    </BoardMessage>
  )
}
