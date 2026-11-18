import { useConnectionsPageStore, type ProfileTarget } from '../../../stores/connections-page-store'
import { BackButton, PageFrame } from '../PageChrome'
import { ProfileHeader } from './ProfileHeader'
import { PROFILE_SECTION_TITLE } from './profile-sections'
import { SaveBar } from './SaveBar'
import { BehaviourSection } from './sections/BehaviourSection'
import { SecuritySection } from './sections/SecuritySection'
import { ServerSection } from './sections/ServerSection'
import { SignInSection } from './sections/SignInSection'
import { useProfileEditor, type ProfileEditor } from './use-profile-editor'

const SECTION_TITLE_SEPARATOR = ' and '

function saveBarLabel(profile: ProfileEditor): string {
  if (profile.isNew) return 'New connection, not saved yet'
  const titles = profile.openSections.map((section) => PROFILE_SECTION_TITLE[section])
  return `Editing ${titles.join(SECTION_TITLE_SEPARATOR)}`
}

function showsSaveBar(profile: ProfileEditor): boolean {
  if (profile.isNew) return true
  return profile.openSections.length > 0
}

function ProfileSaveBar({ profile }: { profile: ProfileEditor }) {
  if (!showsSaveBar(profile)) return null
  return (
    <SaveBar
      label={saveBarLabel(profile)}
      saveLabel={profile.isNew ? 'Save connection' : 'Save changes'}
      isSaving={profile.form.pendingAction !== null}
      onDiscard={profile.discard}
      onSave={() => void profile.save()}
    />
  )
}

function backToBoard(): void {
  const page = useConnectionsPageStore.getState()
  page.requestLeave(page.showBoard)
}

export function ProfileView({ target }: { target: ProfileTarget }) {
  const profile = useProfileEditor(target)
  return (
    <div className="flex min-h-full flex-col" data-testid="connection-profile">
      <PageFrame>
        <BackButton label="Connections" onClick={backToBoard} />
        <ProfileHeader profile={profile} />
        <div className="grid grid-cols-1 gap-x-16 gap-y-10 medium:grid-cols-2">
          <ServerSection profile={profile} />
          <SignInSection profile={profile} />
          <SecuritySection profile={profile} />
          <BehaviourSection profile={profile} />
        </div>
      </PageFrame>
      <ProfileSaveBar profile={profile} />
    </div>
  )
}
