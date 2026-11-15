import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from 'react'
import { XIcon } from '@phosphor-icons/react'
import type { WorkspaceTab } from '../../../types/schema'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import { useObjectEditorStore } from '../../../stores/object-editor-store'
import { UnderlineTab } from '../../common/UnderlineTabs'
import { TextInput } from '../../common/TextInput'
import { IconButton } from '../../common/IconButton'
import type { ContextMenuOpenPoint } from '../../../lib/context-menu-utils'
import { isPinnedWorkspaceTab } from '../../../lib/workspace-tab-stacks'
import { isContextMenuKey } from '../../../lib/input-events'
import { getWorkspaceTabIconDescriptor } from '../workspace-tab-icons'
import { joinClassNames } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'
import { WORKSPACE_TAB_TEST_ID_PREFIX } from './tab-rail-model'
import type { TabRename } from './use-tab-rename'

const TAB_ICON_SIZE = 16
const TAB_ICON_WEIGHT = 'regular'
const MIDDLE_MOUSE_BUTTON = 1

function WorkspaceTabLabel({ tab }: { tab: WorkspaceTab }) {
  const isDesignerDirty = useTableDesignerStore((state) =>
    tab.type === 'table-designer' ? (state.tabs[tab.id]?.isDirty ?? false) : false
  )

  const isObjectEditorDirty = useObjectEditorStore((state) => {
    if (tab.type !== 'object-editor') {
      return false
    }
    const tabState = state.tabs[tab.id]
    if (!tabState) {
      return false
    }
    return tabState.content !== tabState.originalContent
  })

  const isDirty = isDesignerDirty || isObjectEditorDirty
  const { IconComponent, testId } = getWorkspaceTabIconDescriptor(tab)
  const leadingIcon: ReactNode = (
    <IconComponent
      size={TAB_ICON_SIZE}
      weight={TAB_ICON_WEIGHT}
      aria-hidden={true}
      data-testid={testId}
      className="shrink-0"
    />
  )

  return (
    <span className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap group-data-active/tab:text-light-primary dark:group-data-active/tab:text-dark-primary">
      {leadingIcon}
      <span className="min-w-0">{tab.label}</span>
      {isDirty && <span className="text-light-primary dark:text-dark-primary"> ●</span>}
    </span>
  )
}

interface RenameInputProps {
  tab: WorkspaceTab
  rename: TabRename
  renameInputRef: RefObject<HTMLInputElement | null>
}

function RailTabRenameInput({ tab, rename, renameInputRef }: RenameInputProps) {
  return (
    <TextInput
      ref={renameInputRef}
      value={rename.renameDraft}
      className={joinClassNames([
        'min-w-21 max-w-55 rounded-control border border-light-outline bg-light-surface px-1 py-0 text-light-on-surface group-data-active/tab:border-light-primary dark:border-dark-outline dark:bg-dark-surface dark:text-dark-on-surface dark:group-data-active/tab:border-dark-primary',
        FOCUS_RING,
      ])}
      variant="bare"
      data-testid="workspace-tab-rename-input"
      data-tab-drag-ignore="true"
      aria-label={`Rename ${tab.label}`}
      onChange={(event) => rename.setRenameDraft(event.target.value)}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onBlur={() => rename.handleRenameBlur(tab.id)}
      onKeyDown={(event) => rename.handleRenameKeyDown(tab.id, event)}
    />
  )
}

function RailTabCloseButton({ tab, onClose }: { tab: WorkspaceTab; onClose: () => void }) {
  return (
    <IconButton
      size="sm"
      className="group-not-data-active/tab:not-group-hover/tab:invisible"
      aria-label={`Close ${tab.label}`}
      draggable={false}
      data-tab-drag-ignore="true"
      tabIndex={-1}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
    >
      <XIcon size={16} weight="regular" aria-hidden />
    </IconButton>
  )
}

export interface RailTabHandlers {
  onActivate: (tabId: string) => void
  onPointerDown: (tab: WorkspaceTab, event: PointerEvent<HTMLElement>) => void
  onOpenContextMenu: (tabId: string, point: ContextMenuOpenPoint) => void
  onClose: (tabId: string) => void
  onFocusGroupRail?: () => void
}

function handleRailTabKeyDown(
  event: KeyboardEvent<HTMLElement>,
  tabId: string,
  props: WorkspaceRailTabProps
): void {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    props.handlers.onFocusGroupRail?.()
    return
  }
  if (event.key === 'F2') {
    event.preventDefault()
    props.rename.startRename(tabId)
    return
  }
  if (!isContextMenuKey(event)) return
  event.preventDefault()
  const rect = event.currentTarget.getBoundingClientRect()
  props.handlers.onOpenContextMenu(tabId, {
    x: rect.left,
    y: rect.bottom,
    anchor: event.currentTarget,
  })
}

export interface WorkspaceRailTabProps {
  tab: WorkspaceTab
  isActive: boolean
  autoScrollOnActive: boolean
  isDragSource: boolean
  dropIndicator: 'before' | 'after' | undefined
  rename: TabRename
  renameInputRef: RefObject<HTMLInputElement | null>
  handlers: RailTabHandlers
}

export function WorkspaceRailTab(props: WorkspaceRailTabProps) {
  const { tab, rename, renameInputRef, handlers } = props
  const isPinned = isPinnedWorkspaceTab(tab)
  const closeTab = () => handlers.onClose(tab.id)
  const label: ReactNode =
    rename.renamingTabId === tab.id ? (
      <RailTabRenameInput tab={tab} rename={rename} renameInputRef={renameInputRef} />
    ) : (
      <WorkspaceTabLabel tab={tab} />
    )
  return (
    <UnderlineTab
      variant="document"
      active={props.isActive}
      autoScrollOnActive={props.autoScrollOnActive}
      editing={rename.renamingTabId === tab.id}
      data-testid={`${WORKSPACE_TAB_TEST_ID_PREFIX}${tab.id}`}
      onSelect={() => handlers.onActivate(tab.id)}
      onPointerDown={(event) => handlers.onPointerDown(tab, event)}
      onContextMenu={(event) => {
        event.preventDefault()
        handlers.onOpenContextMenu(tab.id, {
          x: event.clientX,
          y: event.clientY,
          anchor: event.currentTarget,
        })
      }}
      onKeyDown={(event) => handleRailTabKeyDown(event, tab.id, props)}
      dragging={props.isDragSource}
      dropIndicator={props.dropIndicator}
      onAuxClick={
        isPinned
          ? undefined
          : (event) => {
              if (event.button !== MIDDLE_MOUSE_BUTTON) return
              event.preventDefault()
              closeTab()
            }
      }
      suffix={isPinned ? undefined : <RailTabCloseButton tab={tab} onClose={closeTab} />}
    >
      <span
        className="inline-flex min-w-0 flex-1 items-center"
        onDoubleClick={(event) => {
          event.stopPropagation()
          rename.startRename(tab.id)
        }}
      >
        {label}
      </span>
    </UnderlineTab>
  )
}
