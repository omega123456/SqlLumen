import { useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { DotsThree, Lock, PencilSimple, ShieldCheck, StackPlus } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { IconButton } from '../../common/IconButton'
import { TextInput } from '../../common/TextInput'
import { Checkbox } from '../../common/Checkbox'
import { connectionEdgeFill } from '../../layout/connection-tab-bar/connection-tab-model'
import { PRIMARY_RING_SPINNER, joinClassNames } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'
import { lastConnectedLabel } from '../../../lib/relative-time'
import type { SavedConnection } from '../../../types/connection'
import { META_ICON_SIZE, PAGE_ICON_SIZE } from '../page-icons'
import { hostLabel } from './board-model'
import type { PasswordSubmission, TileStatus } from './use-tile-actions'

export interface TileHandlers {
  onActivate: (connection: SavedConnection) => void
  onOpenNewSession: (connection: SavedConnection) => void
  onEdit: (profileId: string) => void
  onMore: (event: MouseEvent<HTMLButtonElement>, connection: SavedConnection) => void
  onSubmitPassword: (connection: SavedConnection, submission: PasswordSubmission) => void
  onFocusTile: (tileKey: string) => void
}

export interface ConnectionTileProps {
  connection: SavedConnection
  tileKey: string
  isFocusTarget: boolean
  isOpen: boolean
  status: TileStatus
  handlers: TileHandlers
}

interface TileFooterProps {
  connection: SavedConnection
  isOpen: boolean
  status: TileStatus
  handlers: TileHandlers
}

const META_LINE =
  'mt-auto flex min-w-0 items-center gap-3 pt-2 pr-2 text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant'

function OpenBadge() {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-light-tertiary dark:text-dark-tertiary">
      <span className="size-2 rounded-round bg-light-tertiary dark:bg-dark-tertiary" aria-hidden />
      Open
    </span>
  )
}

function MetaFlag({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {icon}
      {label}
    </span>
  )
}

function ConnectionRecency({ connection, isOpen }: Pick<TileFooterProps, 'connection' | 'isOpen'>) {
  if (isOpen) return <OpenBadge />
  return <span className="shrink-0">{lastConnectedLabel(connection.lastConnectedAt)}</span>
}

function usesTls(connection: SavedConnection): boolean {
  return connection.sslMode !== 'disabled'
}

function IdleFooter({ connection, isOpen }: TileFooterProps) {
  return (
    <span className={META_LINE}>
      <ConnectionRecency connection={connection} isOpen={isOpen} />
      <span className="min-w-0 truncate">{connection.username}</span>
      {connection.readOnly && (
        <MetaFlag icon={<Lock size={META_ICON_SIZE} aria-hidden />} label="Read-only" />
      )}
      {usesTls(connection) && (
        <MetaFlag icon={<ShieldCheck size={META_ICON_SIZE} aria-hidden />} label="TLS" />
      )}
    </span>
  )
}

function BusyFooter() {
  return (
    <span className={META_LINE}>
      <span className={joinClassNames([PRIMARY_RING_SPINNER, 'size-3'])} aria-hidden />
      Connecting…
    </span>
  )
}

function FailedFooter({ connection, status, handlers }: TileFooterProps) {
  const message = status.kind === 'failed' ? status.message : ''
  return (
    <span className={META_LINE}>
      <span className="min-w-0 truncate text-light-error dark:text-dark-error" title={message}>
        {message}
      </span>
      <Button
        variant="subtleAccent"
        size="xs"
        className="pointer-events-auto shrink-0"
        onClick={() => handlers.onEdit(connection.id)}
      >
        Edit
      </Button>
    </span>
  )
}

function PasswordFooter({ connection, status, handlers }: TileFooterProps) {
  const [password, setPassword] = useState('')
  const [savePassword, setSavePassword] = useState(false)
  const message = status.kind === 'needsPassword' ? status.message : null
  const submit = (event: FormEvent) => {
    event.preventDefault()
    handlers.onSubmitPassword(connection, { password: password, savePassword: savePassword })
  }
  return (
    <form className="pointer-events-auto mt-auto flex flex-col gap-2 pt-2 pr-2" onSubmit={submit}>
      <span className="text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {message ?? 'This server needs a password.'}
      </span>
      <div className="flex items-center gap-2">
        <TextInput
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          aria-label={`Password for ${connection.name}`}
          autoFocus
        />
        <Button variant="accent" type="submit" className="shrink-0">
          Connect
        </Button>
      </div>
      <label className="flex items-center gap-2 text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
        <Checkbox
          checked={savePassword}
          onChange={(event) => setSavePassword(event.target.checked)}
        />
        Save password, encrypted on this device
      </label>
    </form>
  )
}

const TILE_FOOTER: Record<TileStatus['kind'], (props: TileFooterProps) => ReactNode> = {
  idle: IdleFooter,
  busy: BusyFooter,
  failed: FailedFooter,
  needsPassword: PasswordFooter,
}

function TileEdge({ color }: { color: string | null }) {
  const fill = connectionEdgeFill(color)
  return (
    <span
      className={joinClassNames(['absolute inset-x-0 top-0 h-0.5', fill.className])}
      style={fill.style}
      aria-hidden
    />
  )
}

function TileActions({
  connection,
  handlers,
}: Pick<ConnectionTileProps, 'connection' | 'handlers'>) {
  return (
    <span className="pointer-events-auto relative flex shrink-0 gap-0.5">
      <IconButton
        size="sm"
        tabIndex={-1}
        aria-label={`Open ${connection.name} in a new session`}
        title="Open in new session"
        onClick={() => handlers.onOpenNewSession(connection)}
      >
        <StackPlus size={PAGE_ICON_SIZE} />
      </IconButton>
      <IconButton
        size="sm"
        tabIndex={-1}
        aria-label={`Edit ${connection.name}`}
        title="Edit"
        onClick={() => handlers.onEdit(connection.id)}
      >
        <PencilSimple size={PAGE_ICON_SIZE} />
      </IconButton>
      <IconButton
        size="sm"
        tabIndex={-1}
        aria-label={`More actions for ${connection.name}`}
        title="More"
        aria-haspopup="menu"
        onClick={(event) => handlers.onMore(event, connection)}
      >
        <DotsThree size={PAGE_ICON_SIZE} weight="bold" />
      </IconButton>
    </span>
  )
}

export function ConnectionTile({
  connection,
  tileKey,
  isFocusTarget,
  isOpen,
  status,
  handlers,
}: ConnectionTileProps) {
  const Footer = TILE_FOOTER[status.kind]
  return (
    <li
      className="group relative flex min-h-connection-tile flex-col overflow-hidden rounded-card bg-light-surface-container-high pt-3.5 pr-2 pb-3 pl-4 shadow-light-elevated transition-bg duration-150 hover:bg-light-card-hover dark:bg-dark-surface-container-high dark:shadow-dark-elevated dark:hover:bg-dark-card-hover"
      data-testid="connection-tile"
      data-status={status.kind}
    >
      <TileEdge color={connection.color} />
      <Button
        variant="bare"
        className={joinClassNames(['absolute inset-0 cursor-pointer rounded-card', FOCUS_RING])}
        aria-label={`Connect to ${connection.name}`}
        aria-busy={status.kind === 'busy'}
        tabIndex={isFocusTarget ? 0 : -1}
        data-tile-key={tileKey}
        data-profile-id={connection.id}
        onFocus={() => handlers.onFocusTile(tileKey)}
        onClick={() => handlers.onActivate(connection)}
      />
      <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1 truncate font-headline text-subtitle font-semibold text-light-on-surface dark:text-dark-on-surface">
            {connection.name}
          </span>
          <TileActions connection={connection} handlers={handlers} />
        </div>
        <span className="truncate pr-2 font-mono text-mono text-light-on-surface-variant dark:text-dark-on-surface-variant">
          {hostLabel(connection)}
        </span>
        <Footer connection={connection} isOpen={isOpen} status={status} handlers={handlers} />
      </div>
    </li>
  )
}
