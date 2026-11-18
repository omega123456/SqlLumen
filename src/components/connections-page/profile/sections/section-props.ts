import type { ProfileEditor } from '../use-profile-editor'
import type { ProfileSection } from '../profile-sections'

export interface SectionProps {
  profile: ProfileEditor
}

export function isEditing(profile: ProfileEditor, section: ProfileSection): boolean {
  return profile.openSections.includes(section)
}
