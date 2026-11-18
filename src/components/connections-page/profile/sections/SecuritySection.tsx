import { FolderOpen } from '@phosphor-icons/react'
import { Button } from '../../../common/Button'
import { Dropdown } from '../../../common/Dropdown'
import { TextInput } from '../../../common/TextInput'
import type { SslMode } from '../../../../types/connection'
import { PAGE_ICON_SIZE } from '../../page-icons'
import type { SslPathField } from '../connection-editor-state'
import { Fact, MonoOrMuted, Muted } from '../FactsList'
import { ProfileSection } from '../ProfileSection'
import {
  SSL_FILE_FIELDS_BY_MODE,
  SSL_MODE_DESCRIPTION,
  SSL_MODE_LABEL,
  SSL_MODE_OPTIONS,
} from '../ssl-mode-options'
import { isEditing, type SectionProps } from './section-props'

const PATH_SEPARATOR_PATTERN = /[\\/]/
const NOT_SET = 'Not set'
const SSL_MODE_LABEL_ID = 'conn-ssl-mode-label'

interface SslFileSpec {
  id: string
  label: string
  placeholder: string
}

const SSL_FILE_SPECS: Record<SslPathField, SslFileSpec> = {
  sslCaPath: { id: 'conn-ssl-ca', label: 'CA certificate', placeholder: 'Optional, public roots' },
  sslCertPath: { id: 'conn-ssl-cert', label: 'Client certificate', placeholder: 'Optional' },
  sslKeyPath: { id: 'conn-ssl-key', label: 'Client key', placeholder: 'Optional' },
}

function fileNameOf(path: string | null): string | null {
  if (!path) return null
  return path.split(PATH_SEPARATOR_PATTERN).pop() ?? path
}

function SecurityFacts({ profile }: SectionProps) {
  const data = profile.form.editor.formData
  return (
    <>
      <Fact label="SSL mode">
        <span className="shrink-0">{SSL_MODE_LABEL[data.sslMode]}</span>
        <Muted>· {SSL_MODE_DESCRIPTION[data.sslMode]}</Muted>
      </Fact>
      <Fact label="CA certificate">
        <MonoOrMuted value={fileNameOf(data.sslCaPath)} fallback={NOT_SET} />
      </Fact>
      <Fact label="Client certificate">
        <MonoOrMuted value={fileNameOf(data.sslCertPath)} fallback={NOT_SET} />
      </Fact>
    </>
  )
}

function SslFileFact({ profile, field }: SectionProps & { field: SslPathField }) {
  const spec = SSL_FILE_SPECS[field]
  const editor = profile.form.editor
  return (
    <Fact label={spec.label} htmlFor={spec.id} error={editor.errors[field]}>
      <TextInput
        id={spec.id}
        variant="mono"
        className="min-w-0 flex-1"
        value={editor.formData[field] ?? ''}
        placeholder={spec.placeholder}
        invalid={editor.errors[field] !== undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => profile.form.updateField(field, event.target.value || null)}
      />
      <Button
        className="shrink-0"
        aria-label={`Browse for ${spec.label.toLowerCase()}`}
        onClick={() => void profile.form.browseSslFile(field)}
      >
        <FolderOpen size={PAGE_ICON_SIZE} aria-hidden className="shrink-0" />
        Browse
      </Button>
    </Fact>
  )
}

function SecurityFields({ profile }: SectionProps) {
  const sslMode = profile.form.editor.formData.sslMode
  return (
    <>
      <Fact label="SSL mode" labelId={SSL_MODE_LABEL_ID}>
        <div className="w-60">
          <Dropdown<SslMode>
            id="conn-ssl-mode"
            labelledBy={SSL_MODE_LABEL_ID}
            options={SSL_MODE_OPTIONS}
            value={sslMode}
            onChange={(mode) => profile.form.updateField('sslMode', mode)}
            data-testid="ssl-mode-dropdown"
          />
        </div>
      </Fact>
      <Fact label="">
        <Muted>{SSL_MODE_DESCRIPTION[sslMode]}</Muted>
      </Fact>
      {SSL_FILE_FIELDS_BY_MODE[sslMode].map((field) => (
        <SslFileFact key={field} profile={profile} field={field} />
      ))}
    </>
  )
}

export function SecuritySection({ profile }: SectionProps) {
  const editing = isEditing(profile, 'security')
  return (
    <ProfileSection
      section="security"
      isEditing={editing}
      onEdit={() => profile.editSection('security')}
    >
      {editing ? <SecurityFields profile={profile} /> : <SecurityFacts profile={profile} />}
    </ProfileSection>
  )
}
