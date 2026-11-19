import type { ConnectionGroupChanges } from '../../../lib/connection-commands'
import type { ConnectionGroup } from '../../../types/connection'

export interface GroupDraft {
  group: ConnectionGroup
  name: string
  color: string | null
}

export type GroupEditorClosing = 'save' | 'keepColour'

export function startGroupDraft(group: ConnectionGroup): GroupDraft {
  return { group: group, name: group.name, color: group.color }
}

export function renamedDraft(draft: GroupDraft, name: string): GroupDraft {
  return { ...draft, name: name }
}

export function recolouredDraft(draft: GroupDraft, color: string | null): GroupDraft {
  return { ...draft, color: color }
}

export function previewedGroup(draft: GroupDraft): ConnectionGroup {
  return { ...draft.group, color: draft.color }
}

function nameToSave(draft: GroupDraft, closing: GroupEditorClosing): string {
  const trimmedName = draft.name.trim()
  if (closing === 'keepColour') return draft.group.name
  if (trimmedName === '') return draft.group.name
  return trimmedName
}

export function groupChangesToSave(
  draft: GroupDraft,
  closing: GroupEditorClosing
): ConnectionGroupChanges | null {
  const name = nameToSave(draft, closing)
  const isUnchanged = name === draft.group.name && draft.color === draft.group.color
  if (isUnchanged) return null
  return { id: draft.group.id, name: name, color: draft.color }
}
