import { CheckCircle, Plug } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type { ConnectionFormData, TestConnectionResult } from '../../../types/connection'
import { PAGE_ICON_SIZE } from '../page-icons'
import type { ProfileEditor } from './use-profile-editor'

const NEW_CONNECTION_TITLE = 'New connection'

function profileTitle(data: ConnectionFormData): string {
  return data.name.trim() || data.host.trim() || NEW_CONNECTION_TITLE
}

function userPrefix(username: string): string {
  return username === '' ? '' : `${username}@`
}

function databaseSuffix(database: string | null): string {
  return database ? ` / ${database}` : ''
}

function connectionAddress(data: ConnectionFormData): string {
  return `${userPrefix(data.username)}${data.host}:${data.port}${databaseSuffix(data.defaultDatabase)}`
}

function ProfileSubtitle({ data }: { data: ConnectionFormData }) {
  const hasHost = data.host.trim() !== ''
  if (!hasHost) {
    return (
      <span className="pl-6 text-body text-light-on-surface-variant dark:text-dark-on-surface-variant">
        Fill in the server and sign-in to connect.
      </span>
    )
  }
  return (
    <span className="truncate pl-6 font-mono text-mono text-light-on-surface-variant dark:text-dark-on-surface-variant">
      {connectionAddress(data)}
    </span>
  )
}

function TitleDot({ color }: { color: string | null }) {
  if (color === null) {
    return (
      <span
        className="size-3 shrink-0 rounded-round bg-light-outline dark:bg-dark-outline"
        aria-hidden
      />
    )
  }
  return (
    <span
      className="size-3 shrink-0 rounded-round"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  )
}

function TestOutcome({ result }: { result: TestConnectionResult | null }) {
  if (result === null) return <span role="status" />
  if (!result.success) {
    return (
      <span role="status" className="text-row text-light-error dark:text-dark-error">
        Could not connect: {result.errorMessage}
      </span>
    )
  }
  return (
    <span
      role="status"
      className="flex items-center gap-1.5 text-row text-light-tertiary dark:text-dark-tertiary"
    >
      <CheckCircle size={PAGE_ICON_SIZE} weight="fill" aria-hidden className="shrink-0" />
      Reachable · MySQL {result.serverVersion} · {result.connectionTimeMs} ms
    </span>
  )
}

function testLabel(profile: ProfileEditor): string {
  const isTesting = profile.form.pendingAction === 'test'
  return isTesting ? 'Testing…' : 'Test connection'
}

function connectLabel(profile: ProfileEditor): string {
  return profile.isNew ? 'Save and connect' : 'Connect'
}

export function ProfileHeader({ profile }: { profile: ProfileEditor }) {
  const { formData, testResult } = profile.form.editor
  const isBusy = profile.form.pendingAction !== null
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-3">
          <TitleDot color={formData.color} />
          <h1 className="truncate font-headline text-title font-semibold text-light-on-surface dark:text-dark-on-surface">
            {profileTitle(formData)}
          </h1>
        </div>
        <ProfileSubtitle data={formData} />
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <Button onClick={() => void profile.form.runTestConnection()} disabled={isBusy}>
            <Plug size={PAGE_ICON_SIZE} aria-hidden className="shrink-0" />
            {testLabel(profile)}
          </Button>
          <Button variant="accent" onClick={() => void profile.connect()} disabled={isBusy}>
            {connectLabel(profile)}
          </Button>
        </div>
        <TestOutcome result={testResult} />
      </div>
    </header>
  )
}
