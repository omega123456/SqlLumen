import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import { Trash } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { TextInput } from '../../common/TextInput'
import { useDismissOnOutsideClick } from '../../../hooks/use-dismiss-on-outside-click'
import { joinClassNames } from '../../../lib/class-names'
import { FIELD_CHROME } from '../../../lib/class-names-field'
import { ColorPickerPopover, COLOR_PICKER_PANEL_SELECTOR } from '../profile/ColorPickerPopover'
import { PAGE_ICON_SIZE } from '../page-icons'
import type { GroupDraft, GroupEditorClosing } from './group-editor-draft'

export interface GroupEditorActions {
  onRename: (name: string) => void
  onRecolour: (color: string | null) => void
  onClose: (closing: GroupEditorClosing) => void
  onDismiss: () => void
  onDelete: () => void
}

interface GroupEditorFieldProps {
  draft: GroupDraft
  actions: GroupEditorActions
}

interface GroupEditPopoverProps extends GroupEditorFieldProps {
  returnFocusRef: RefObject<HTMLElement | null>
}

function useSelectedOnOpen() {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  return inputRef
}

function saveOnEnter(event: KeyboardEvent, actions: GroupEditorActions): void {
  if (event.key !== 'Enter') return
  event.preventDefault()
  actions.onClose('save')
}

function closeOnEscape(event: KeyboardEvent, actions: GroupEditorActions): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  actions.onClose('keepColour')
}

function ColourValue({ color }: { color: string | null }) {
  if (color === null) return <span>None</span>
  return (
    <span className="font-mono text-mono text-light-on-surface dark:text-dark-on-surface">
      {color}
    </span>
  )
}

function NameField({ draft, actions }: GroupEditorFieldProps) {
  const inputRef = useSelectedOnOpen()
  return (
    <label className="flex flex-col gap-1 text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
      Name
      <TextInput
        ref={inputRef}
        variant="bare"
        type="text"
        className={joinClassNames([
          FIELD_CHROME,
          'w-full px-2 py-1 text-size-body text-light-on-surface dark:text-dark-on-surface',
        ])}
        value={draft.name}
        onChange={(event) => actions.onRename(event.target.value)}
        onKeyDown={(event) => saveOnEnter(event, actions)}
        aria-label="Group name"
      />
    </label>
  )
}

function ColourField({ draft, actions }: GroupEditorFieldProps) {
  return (
    <div className="flex flex-col gap-1 text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
      Colour
      <div className="flex min-h-8 items-center gap-2 text-body">
        <ColorPickerPopover color={draft.color} onChange={actions.onRecolour} />
        <ColourValue color={draft.color} />
      </div>
    </div>
  )
}

export function GroupEditPopover({
  draft,
  actions: editorActions,
  returnFocusRef,
}: GroupEditPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const actions: GroupEditorActions = {
    ...editorActions,
    onClose: (closing) => {
      editorActions.onClose(closing)
      returnFocusRef.current?.focus()
    },
  }
  useDismissOnOutsideClick({
    ref: popoverRef,
    active: true,
    onDismiss: actions.onDismiss,
    options: { ignoreInside: COLOR_PICKER_PANEL_SELECTOR },
  })

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Edit group ${draft.group.name}`}
      data-testid="group-edit-popover"
      className="absolute top-full right-0 z-1000 mt-1 flex w-72 flex-col gap-3 rounded-overlay border border-light-stroke-flyout bg-light-surface-container-high p-3 shadow-light-flyout dark:border-dark-stroke-flyout dark:bg-dark-surface-container-high dark:shadow-dark-flyout"
      onKeyDown={(event) => closeOnEscape(event, actions)}
    >
      <span className="text-body font-semibold text-light-on-surface dark:text-dark-on-surface">
        Edit group
      </span>
      <NameField draft={draft} actions={actions} />
      <ColourField draft={draft} actions={actions} />
      <span
        className="-mx-3 h-px bg-light-stroke-divider dark:bg-dark-stroke-divider"
        aria-hidden
      />
      <div className="flex items-center justify-between">
        <Button variant="subtle" size="sm" dangerText onClick={actions.onDelete}>
          <Trash size={PAGE_ICON_SIZE} aria-hidden className="shrink-0" />
          Delete group
        </Button>
        <Button size="sm" onClick={() => actions.onClose('save')}>
          Done
        </Button>
      </div>
    </div>
  )
}
