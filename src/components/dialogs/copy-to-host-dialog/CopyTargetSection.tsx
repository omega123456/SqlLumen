import type { RefObject } from 'react'
import { Info, Warning } from '@phosphor-icons/react'
import { TextInput } from '../../common/TextInput'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { NEW_DB_SENTINEL } from './copy-to-host-model'
import { Section } from './CopySection'
import {
  DIALOG_SECTION_FIELD_GROUP,
  DIALOG_SECTION_FIELD_LABEL,
} from '../../../lib/class-names-dialog'

export interface CopyTargetState {
  connectionOptions: DropdownOption[]
  connectionId: string
  databaseOptions: DropdownOption[]
  databaseValue: string
  newDatabaseName: string
  notice: string | null
  isSameHost: boolean
}

export interface CopyTargetHandlers {
  onConnectionChange: (connectionId: string) => void
  onDatabaseChange: (value: string) => void
  onNewDatabaseNameChange: (name: string) => void
}

interface CopyTargetSectionProps {
  target: CopyTargetState
  newDatabaseInputRef: RefObject<HTMLInputElement | null>
  handlers: CopyTargetHandlers
}

function TargetDatabaseExtras({ target, newDatabaseInputRef, handlers }: CopyTargetSectionProps) {
  return (
    <>
      {target.databaseValue === NEW_DB_SENTINEL && (
        <div className="mt-2">
          <TextInput
            ref={newDatabaseInputRef}
            value={target.newDatabaseName}
            onChange={(event) => handlers.onNewDatabaseNameChange(event.target.value)}
            placeholder="new_database_name"
            aria-label="New database name"
            data-testid="copy-new-database-name"
          />
        </div>
      )}
      {target.notice && (
        <p
          className="mt-1.5 flex items-center gap-2 font-body text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant"
          data-testid="copy-target-database-notice"
        >
          <Info
            size={14}
            weight="fill"
            className="shrink-0 text-light-primary dark:text-dark-primary"
          />
          {target.notice}
        </p>
      )}
    </>
  )
}

export function CopyTargetSection({
  target,
  newDatabaseInputRef,
  handlers,
}: CopyTargetSectionProps) {
  return (
    <Section title="Target" testId="copy-target-section">
      <div className={DIALOG_SECTION_FIELD_GROUP}>
        <label className={DIALOG_SECTION_FIELD_LABEL} id="copy-target-connection-label">
          Connection
        </label>
        <Dropdown
          id="copy-target-connection"
          labelledBy="copy-target-connection-label"
          options={target.connectionOptions}
          value={target.connectionId}
          onChange={handlers.onConnectionChange}
          data-testid="copy-target-connection"
        />
      </div>
      <div className={DIALOG_SECTION_FIELD_GROUP}>
        <label className={DIALOG_SECTION_FIELD_LABEL} id="copy-target-database-label">
          Database
        </label>
        <Dropdown
          id="copy-target-database"
          labelledBy="copy-target-database-label"
          options={target.databaseOptions}
          value={target.databaseValue}
          disabled={!target.connectionId}
          onChange={handlers.onDatabaseChange}
          data-testid="copy-target-database"
        />
        <TargetDatabaseExtras
          target={target}
          newDatabaseInputRef={newDatabaseInputRef}
          handlers={handlers}
        />
      </div>
      {target.isSameHost && (
        <p
          className="mt-1 flex items-center gap-2 font-body text-size-caption text-light-warning dark:text-dark-warning"
          data-testid="copy-same-host-warning"
        >
          <Warning
            size={14}
            weight="fill"
            className="shrink-0 text-light-warning dark:text-dark-warning"
          />
          The target resolves to the same host as the source. Choose a different host.
        </p>
      )}
    </Section>
  )
}
