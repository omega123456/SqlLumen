import { useCallback, useState } from 'react'
import { useConnectionStore } from '../../../stores/connection-store'
import {
  createConnectionGroup,
  deleteConnectionGroup,
  updateConnectionGroup,
  type ConnectionGroupChanges,
} from '../../../lib/connection-commands'
import { showErrorToast, showSuccessToast } from '../../../stores/toast-store'
import { toErrorMessage } from '../../../lib/error-message'
import type { ConnectionGroup } from '../../../types/connection'
import type { GroupMutation } from './connection-sections'
import {
  groupChangesToSave,
  previewedGroup,
  recolouredDraft,
  renamedDraft,
  startGroupDraft,
  type GroupDraft,
  type GroupEditorClosing,
} from './group-editor-draft'
import { useDeleteConfirmation, type DeleteConfirmationSpec } from './use-delete-confirmation'

const GROUP_DELETION: DeleteConfirmationSpec<ConnectionGroup> = {
  remove: (group) => deleteConnectionGroup(group.id),
  describe: (group) => `${group.name}. Its connections moved to Ungrouped.`,
  successTitle: 'Group deleted',
  failureTitle: 'Failed to delete group',
}

async function runGroupMutation(mutation: GroupMutation): Promise<void> {
  const store = useConnectionStore.getState()
  try {
    await mutation.run()
    showSuccessToast(mutation.successTitle, mutation.groupName)
  } catch (error) {
    showErrorToast(mutation.failureTitle, toErrorMessage(error))
  }
  await store.fetchSavedConnections()
}

function createGroupMutation(name: string): GroupMutation {
  return {
    run: () => createConnectionGroup(name),
    successTitle: 'Group created',
    failureTitle: 'Failed to create group',
    groupName: name,
  }
}

function saveGroupMutation(changes: ConnectionGroupChanges): GroupMutation {
  return {
    run: () => updateConnectionGroup(changes),
    successTitle: 'Group saved',
    failureTitle: 'Failed to save group',
    groupName: changes.name,
  }
}

function findGroup(groupId: string): ConnectionGroup | null {
  const groups = useConnectionStore.getState().connectionGroups
  return groups.find((group) => group.id === groupId) ?? null
}

function previewDraft(draft: GroupDraft): void {
  useConnectionStore.getState().previewConnectionGroup(previewedGroup(draft))
}

function useNewGroup() {
  const [newGroupName, setNewGroupName] = useState<string | null>(null)

  const commitCreate = async () => {
    const trimmedName = newGroupName?.trim() ?? ''
    setNewGroupName(null)
    if (!trimmedName) return
    await runGroupMutation(createGroupMutation(trimmedName))
  }

  return {
    newGroupName: newGroupName,
    startCreate: () => setNewGroupName(''),
    changeNewGroupName: setNewGroupName,
    commitCreate: commitCreate,
    cancelCreate: () => setNewGroupName(null),
  }
}

function useGroupDraft() {
  const [draft, setDraft] = useState<GroupDraft | null>(null)

  const openEditor = useCallback((groupId: string) => {
    const group = findGroup(groupId)
    if (group) setDraft(startGroupDraft(group))
  }, [])

  const rename = (name: string) => {
    if (!draft) return
    setDraft(renamedDraft(draft, name))
  }

  const recolour = (color: string | null) => {
    if (!draft) return
    const next = recolouredDraft(draft, color)
    previewDraft(next)
    setDraft(next)
  }

  const closeEditor = async (closing: GroupEditorClosing) => {
    if (!draft) return
    setDraft(null)
    const changes = groupChangesToSave(draft, closing)
    if (changes === null) return
    await runGroupMutation(saveGroupMutation(changes))
  }

  const discardDraft = () => {
    if (!draft) return
    useConnectionStore.getState().previewConnectionGroup(draft.group)
    setDraft(null)
  }

  return {
    draft: draft,
    openEditor: openEditor,
    rename: rename,
    recolour: recolour,
    closeEditor: closeEditor,
    discardDraft: discardDraft,
  }
}

export function useGroupEditing() {
  const newGroup = useNewGroup()
  const editor = useGroupDraft()
  const deletion = useDeleteConfirmation(GROUP_DELETION)

  const requestDelete = (groupId: string) => {
    const group = findGroup(groupId)
    editor.discardDraft()
    if (group) deletion.requestDelete(group)
  }

  return {
    ...newGroup,
    ...editor,
    pendingDelete: deletion.pendingDelete,
    requestDelete: requestDelete,
    cancelDelete: deletion.cancelDelete,
    confirmDelete: deletion.confirmDelete,
  }
}

export type GroupEditing = ReturnType<typeof useGroupEditing>
