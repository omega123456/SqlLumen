import { TextInput } from '../../../common/TextInput'
import { Checkbox } from '../../../common/Checkbox'
import { Fact, Mono, Muted } from '../FactsList'
import { ProfileSection } from '../ProfileSection'
import { TextFieldInput } from './section-fields'
import { isEditing, type SectionProps } from './section-props'

const SAVED_PASSWORD_MASK = '••••••••'

function passwordSummary({ profile }: SectionProps) {
  if (profile.form.editor.hasSavedPassword) return 'Saved, encrypted on this device'
  return <Muted>Asked when connecting</Muted>
}

function SignInFacts({ profile }: SectionProps) {
  return (
    <>
      <Fact label="User">
        <Mono>{profile.form.editor.formData.username}</Mono>
      </Fact>
      <Fact label="Password">{passwordSummary({ profile: profile })}</Fact>
    </>
  )
}

function passwordPlaceholder({ profile }: SectionProps): string {
  const editor = profile.form.editor
  const keepsSavedPassword = editor.hasSavedPassword && editor.savePassword
  return keepsSavedPassword ? SAVED_PASSWORD_MASK : ''
}

function DuplicatePasswordHint({ profile }: SectionProps) {
  if (!profile.seed?.sourceHadPassword) return null
  return (
    <Fact label="">
      <span
        className="text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant"
        data-testid="duplicate-password-hint"
      >
        The password is not copied. Enter it to save it.
      </span>
    </Fact>
  )
}

function SignInFields({ profile }: SectionProps) {
  const editor = profile.form.editor
  return (
    <>
      <Fact label="User" htmlFor="conn-username" error={editor.errors.username}>
        <TextFieldInput
          id="conn-username"
          profile={profile}
          field="username"
          input={{ variant: 'mono', placeholder: 'root' }}
        />
      </Fact>
      <Fact label="Password" htmlFor="conn-password">
        <TextInput
          id="conn-password"
          type="password"
          value={editor.formData.password}
          placeholder={passwordPlaceholder({ profile: profile })}
          autoComplete="off"
          onChange={(event) => profile.form.updateField('password', event.target.value)}
        />
      </Fact>
      <DuplicatePasswordHint profile={profile} />
      <Fact label="">
        <label className="flex items-center gap-2 text-body text-light-on-surface-variant dark:text-dark-on-surface-variant">
          <Checkbox
            checked={editor.savePassword}
            onChange={(event) => profile.form.changeSavePassword(event.target.checked)}
          />
          Save password, encrypted on this device
        </label>
      </Fact>
    </>
  )
}

export function SignInSection({ profile }: SectionProps) {
  const editing = isEditing(profile, 'signIn')
  return (
    <ProfileSection
      section="signIn"
      isEditing={editing}
      onEdit={() => profile.editSection('signIn')}
    >
      {editing ? <SignInFields profile={profile} /> : <SignInFacts profile={profile} />}
    </ProfileSection>
  )
}
