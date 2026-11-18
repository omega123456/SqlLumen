import { useEffect, useMemo, useState } from 'react'
import { useConnectionStore } from '../../../stores/connection-store'
import { useConnectionsPageStore, type ProfileTarget } from '../../../stores/connections-page-store'
import type { ConnectionFormSeed, SavedConnection } from '../../../types/connection'
import { editorStateFor, type ConnectionEditorState } from './connection-editor-state'
import {
  PROFILE_SECTION_ORDER,
  initialOpenSections,
  isSectionDirty,
  type ProfileSection,
} from './profile-sections'
import { useConnectionFormActions } from './useConnectionFormActions'
import { openSessionOf } from '../board/board-model'

const SAVE_PASSWORD_BY_DEFAULT = true

function existingProfileId(target: ProfileTarget): string | null {
  return target.kind === 'existing' ? target.profileId : null
}

function seedOf(target: ProfileTarget): ConnectionFormSeed | undefined {
  if (target.kind !== 'new') return undefined
  return target.seed ?? undefined
}

function isSameRevision(
  left: SavedConnection | undefined,
  right: SavedConnection | undefined
): boolean {
  if (left === undefined) return right === undefined
  if (right === undefined) return false
  const isSameProfile = left.id === right.id
  return isSameProfile && left.updatedAt === right.updatedAt
}

function useSavedProfile(profileId: string | null): SavedConnection | undefined {
  const profile = useConnectionStore((state) =>
    state.savedConnections.find((connection) => connection.id === profileId)
  )
  const [currentRevision, setCurrentRevision] = useState(profile)
  if (!isSameRevision(profile, currentRevision)) setCurrentRevision(profile)
  return currentRevision
}

function dirtySections(editor: ConnectionEditorState, baseline: ConnectionEditorState) {
  const passwordChoiceChanged = editor.savePassword !== SAVE_PASSWORD_BY_DEFAULT
  return PROFILE_SECTION_ORDER.filter((section) => {
    const isPasswordChoice = section === 'signIn' && passwordChoiceChanged
    if (isPasswordChoice) return true
    return isSectionDirty({
      section: section,
      current: editor.formData,
      baseline: baseline.formData,
    })
  })
}

function withSections(open: ProfileSection[], added: ProfileSection[]): ProfileSection[] {
  const shown = new Set([...open, ...added])
  return PROFILE_SECTION_ORDER.filter((section) => shown.has(section))
}

function useUnsavedEditsSync(hasUnsavedEdits: boolean): void {
  const setUnsavedEdits = useConnectionsPageStore((state) => state.setUnsavedEdits)
  useEffect(() => {
    setUnsavedEdits(hasUnsavedEdits)
  }, [hasUnsavedEdits, setUnsavedEdits])
  useEffect(() => () => setUnsavedEdits(false), [setUnsavedEdits])
}

async function connectProfile(
  savedProfile: SavedConnection | undefined,
  saveAndConnect: () => Promise<void>
): Promise<void> {
  const store = useConnectionStore.getState()
  const sessionId = savedProfile ? openSessionOf(store.activeConnections, savedProfile.id) : null
  if (sessionId === null) {
    await saveAndConnect()
    return
  }
  store.switchTab(sessionId)
  useConnectionsPageStore.getState().closePage()
}

export function useProfileEditor(target: ProfileTarget) {
  const isNew = target.kind === 'new'
  const savedProfile = useSavedProfile(existingProfileId(target))
  const seed = seedOf(target)
  const baseline = useMemo(() => editorStateFor(savedProfile, seed), [savedProfile, seed])
  const [openSections, setOpenSections] = useState<ProfileSection[]>(() =>
    initialOpenSections(isNew)
  )
  const form = useConnectionFormActions({
    editingConnection: savedProfile,
    initialData: seed,
    onInvalidSections: (sections) => setOpenSections((open) => withSections(open, sections)),
  })
  const changedSections = dirtySections(form.editor, baseline)
  useUnsavedEditsSync(changedSections.length > 0)

  const discardEdits = () => {
    form.replaceFormData(baseline.formData)
    form.changeSavePassword(SAVE_PASSWORD_BY_DEFAULT)
    setOpenSections([])
  }

  const editSection = (section: ProfileSection) => {
    useConnectionsPageStore.getState().requestLeave(() => {
      discardEdits()
      setOpenSections([section])
    })
  }

  const leaveNewProfile = () => {
    const page = useConnectionsPageStore.getState()
    page.setUnsavedEdits(false)
    page.showBoard()
  }

  const discard = isNew ? leaveNewProfile : discardEdits

  const save = async () => {
    const savedId = await form.save()
    if (savedId === null) return
    setOpenSections([])
    if (isNew) {
      useConnectionsPageStore.getState().showProfile({ kind: 'existing', profileId: savedId })
    }
  }

  return {
    isNew: isNew,
    form: form,
    seed: seed,
    savedProfile: savedProfile,
    openSections: openSections,
    editSection: editSection,
    discard: discard,
    save: save,
    connect: () => connectProfile(savedProfile, form.connect),
  }
}

export type ProfileEditor = ReturnType<typeof useProfileEditor>
