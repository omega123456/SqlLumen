import { useCallback, useEffect, useState } from 'react'
import { useConnectionStore } from '../../../stores/connection-store'
import {
  createConnectionGroup,
  deleteConnectionGroup,
  updateConnectionGroup,
} from '../../../lib/connection-commands'
import { showErrorToast, showSuccessToast } from '../../../stores/toast-store'
import type { EditingGroupState, GroupMutation } from './connection-sections'

const ERROR_AUTO_CLEAR_MS = 5000
const DELETE_GROUP_FAILED = 'Failed to delete group'
const DELETE_GROUP_CONFIRMATION =
  'Are you sure you want to delete this group? Connections will be moved to ungrouped.'

function useAutoClearingError() {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), ERROR_AUTO_CLEAR_MS)
    return () => clearTimeout(timer)
  }, [error])
  return { error: error, setError: setError }
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function useGroupMutations(setError: (message: string) => void) {
  const fetchSavedConnections = useConnectionStore((state) => state.fetchSavedConnections)

  const runGroupMutation = useCallback(
    async (mutation: GroupMutation) => {
      try {
        await mutation.run()
        await fetchSavedConnections()
        showSuccessToast(mutation.successTitle, mutation.groupName)
      } catch (error) {
        const message = failureMessage(error, mutation.failureTitle)
        setError(message)
        showErrorToast(mutation.failureTitle, message)
      }
    },
    [fetchSavedConnections, setError]
  )

  const deleteGroup = useCallback(
    async (groupId: string) => {
      if (!window.confirm(DELETE_GROUP_CONFIRMATION)) return
      try {
        await deleteConnectionGroup(groupId)
        await fetchSavedConnections()
        showSuccessToast('Group deleted')
      } catch (error) {
        const message = failureMessage(error, DELETE_GROUP_FAILED)
        setError(message)
        showErrorToast(DELETE_GROUP_FAILED, message)
      }
    },
    [fetchSavedConnections, setError]
  )

  return { runGroupMutation: runGroupMutation, deleteGroup: deleteGroup }
}

function createGroupMutation(name: string): GroupMutation {
  return {
    run: () => createConnectionGroup(name),
    successTitle: 'Group created',
    failureTitle: 'Failed to create group',
    groupName: name,
  }
}

function renameGroupMutation(groupId: string, name: string): GroupMutation {
  return {
    run: () => updateConnectionGroup(groupId, name),
    successTitle: 'Group renamed',
    failureTitle: 'Failed to rename group',
    groupName: name,
  }
}

export function useGroupEditing() {
  const connectionGroups = useConnectionStore((state) => state.connectionGroups)
  const [editingGroup, setEditingGroup] = useState<EditingGroupState>(null)
  const { error, setError } = useAutoClearingError()
  const { runGroupMutation, deleteGroup } = useGroupMutations(setError)

  const commitEditing = useCallback(async () => {
    if (!editingGroup) return
    const trimmedName = editingGroup.value.trim()

    if (editingGroup.mode === 'create') {
      setEditingGroup(null)
      if (!trimmedName) return
      await runGroupMutation(createGroupMutation(trimmedName))
      return
    }

    if (trimmedName) {
      await runGroupMutation(renameGroupMutation(editingGroup.groupId, trimmedName))
    }
    setEditingGroup(null)
  }, [editingGroup, runGroupMutation])

  const startRename = useCallback(
    (groupId: string) => {
      const group = connectionGroups.find((connectionGroup) => connectionGroup.id === groupId)
      if (group) {
        setEditingGroup({ mode: 'rename', groupId: groupId, value: group.name })
      }
    },
    [connectionGroups]
  )

  const changeValue = useCallback((value: string) => {
    setEditingGroup((previous) => (previous ? { ...previous, value: value } : null))
  }, [])

  return {
    editingGroup: editingGroup,
    error: error,
    dismissError: () => setError(null),
    startCreate: () => setEditingGroup({ mode: 'create', value: '' }),
    startRename: startRename,
    changeValue: changeValue,
    commitEditing: commitEditing,
    cancelEditing: () => setEditingGroup(null),
    deleteGroup: deleteGroup,
  }
}

export type GroupEditing = ReturnType<typeof useGroupEditing>
