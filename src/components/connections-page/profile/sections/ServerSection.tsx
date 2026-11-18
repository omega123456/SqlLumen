import { TextInput } from '../../../common/TextInput'
import { Fact, Mono, MonoOrMuted, Muted } from '../FactsList'
import { ProfileSection } from '../ProfileSection'
import { NumberFieldInput, TextFieldInput } from './section-fields'
import { isEditing, type SectionProps } from './section-props'

function timeoutsSummary({ profile }: SectionProps): string {
  const data = profile.form.editor.formData
  return `${data.connectTimeoutSecs} s to connect · ${data.keepaliveIntervalSecs} s keepalive`
}

function ServerFacts({ profile }: SectionProps) {
  const data = profile.form.editor.formData
  return (
    <>
      <Fact label="Host">
        <Mono>{data.host}</Mono>
      </Fact>
      <Fact label="Port">
        <Mono>{data.port}</Mono>
      </Fact>
      <Fact label="Database">
        <MonoOrMuted value={data.defaultDatabase} fallback="None, pick after connecting" />
      </Fact>
      <Fact label="Timeouts">{timeoutsSummary({ profile: profile })}</Fact>
    </>
  )
}

function timeoutError({ profile }: SectionProps): string | undefined {
  const errors = profile.form.editor.errors
  return errors.connectTimeoutSecs ?? errors.keepaliveIntervalSecs
}

function ServerFields({ profile }: SectionProps) {
  const { formData, errors } = profile.form.editor
  return (
    <>
      <Fact label="Host" htmlFor="conn-host" error={errors.host}>
        <TextFieldInput
          id="conn-host"
          profile={profile}
          field="host"
          input={{ variant: 'mono', placeholder: 'db.example.com' }}
        />
      </Fact>
      <Fact label="Port" htmlFor="conn-port" error={errors.port}>
        <div className="w-port-field">
          <NumberFieldInput id="conn-port" profile={profile} field="port" />
        </div>
      </Fact>
      <Fact label="Database" htmlFor="conn-database">
        <TextInput
          id="conn-database"
          variant="mono"
          value={formData.defaultDatabase ?? ''}
          placeholder="Optional"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) =>
            profile.form.updateField('defaultDatabase', event.target.value || null)
          }
        />
      </Fact>
      <Fact label="Timeouts" error={timeoutError({ profile: profile })}>
        <div className="w-port-field shrink-0">
          <NumberFieldInput
            id="conn-connect-timeout"
            profile={profile}
            field="connectTimeoutSecs"
            input={{ 'aria-label': 'Connect timeout in seconds' }}
          />
        </div>
        <Muted>s to connect</Muted>
        <div className="ml-2 w-port-field shrink-0">
          <NumberFieldInput
            id="conn-keepalive"
            profile={profile}
            field="keepaliveIntervalSecs"
            input={{ 'aria-label': 'Keepalive interval in seconds' }}
          />
        </div>
        <Muted>s keepalive</Muted>
      </Fact>
    </>
  )
}

export function ServerSection({ profile }: SectionProps) {
  const editing = isEditing(profile, 'server')
  return (
    <ProfileSection
      section="server"
      isEditing={editing}
      onEdit={() => profile.editSection('server')}
    >
      {editing ? <ServerFields profile={profile} /> : <ServerFacts profile={profile} />}
    </ProfileSection>
  )
}
