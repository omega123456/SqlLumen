import { useEffect, useRef, useState } from 'react'

export interface MemoryAddForm {
  addOpen: boolean
  draft: string
  setDraft: (draft: string) => void
  isSaveDisabled: boolean
  openAdd: () => void
  closeAdd: (returnFocus: boolean) => void
  handleSave: () => Promise<void>
}

export function useMemoryAddForm(onAdd: (content: string) => Promise<void>) {
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const addTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (addOpen) textareaRef.current?.focus()
  }, [addOpen])

  const closeAdd = (returnFocus: boolean) => {
    setAddOpen(false)
    setDraft('')
    if (returnFocus) addTriggerRef.current?.focus()
  }

  const handleSave = async () => {
    const content = draft.trim()
    if (!content) return
    if (saving) return
    setSaving(true)
    try {
      await onAdd(content)
      closeAdd(true)
    } finally {
      setSaving(false)
    }
  }

  const form: MemoryAddForm = {
    addOpen: addOpen,
    draft: draft,
    setDraft: setDraft,
    isSaveDisabled: saving || draft.trim().length === 0,
    openAdd: () => setAddOpen(true),
    closeAdd: closeAdd,
    handleSave: handleSave,
  }
  return { form, textareaRef, addTriggerRef }
}
