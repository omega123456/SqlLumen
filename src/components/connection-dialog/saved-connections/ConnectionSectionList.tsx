import { isEditableFieldElement } from '../../../lib/context-menu-utils'
import { GroupInlineInput } from './GroupInlineInput'
import { ConnectionListItem, type ConnectionItemHandlers } from './ConnectionListItem'
import {
  sectionKey,
  sectionRenameValue,
  sectionTitle,
  shouldHideSection,
  type ConnectionSection,
} from './connection-sections'
import type { GroupEditing } from './use-group-editing'
import styles from '../SavedConnectionsList.module.css'

interface SectionListContext {
  groups: GroupEditing
  isFiltering: boolean
  selectedConnectionId: string | null
  itemHandlers: ConnectionItemHandlers
  onGroupContextMenu: (event: React.MouseEvent, groupId: string) => void
}

function groupHeaderContextMenu(section: ConnectionSection, context: SectionListContext) {
  const groupId = section.groupId
  if (groupId === null) return undefined
  return (event: React.MouseEvent) => {
    if (isEditableFieldElement(event.target)) {
      return
    }
    context.onGroupContextMenu(event, groupId)
  }
}

function ConnectionSectionGroup({
  section,
  context,
}: {
  section: ConnectionSection
  context: SectionListContext
}) {
  const { groups } = context
  const renameValue = sectionRenameValue(section, groups.editingGroup)
  const isRenaming = renameValue !== null
  const isHidden = shouldHideSection({
    section: section,
    isFiltering: context.isFiltering,
    isRenaming: isRenaming,
  })
  if (isHidden) return null

  return (
    <div className={styles.group}>
      <div className={styles.groupHeader} onContextMenu={groupHeaderContextMenu(section, context)}>
        {isRenaming ? (
          <GroupInlineInput
            value={renameValue}
            onChange={groups.changeValue}
            onCommit={() => void groups.commitEditing()}
            onCancel={groups.cancelEditing}
            ariaLabel="Group name"
          />
        ) : (
          <span className={styles.groupName}>{sectionTitle(section)}</span>
        )}
      </div>
      {section.connections.map((connection) => (
        <ConnectionListItem
          key={connection.id}
          connection={connection}
          isSelected={connection.id === context.selectedConnectionId}
          handlers={context.itemHandlers}
        />
      ))}
    </div>
  )
}

function NewGroupInput({ groups }: { groups: GroupEditing }) {
  const { editingGroup } = groups
  const isCreatingGroup = editingGroup?.mode === 'create'
  if (!isCreatingGroup) return null
  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <GroupInlineInput
          value={editingGroup.value}
          onChange={groups.changeValue}
          onCommit={() => void groups.commitEditing()}
          onCancel={groups.cancelEditing}
          placeholder="Group name"
          ariaLabel="New group name"
        />
      </div>
    </div>
  )
}

interface ConnectionSectionListProps {
  sections: ConnectionSection[]
  emptyFilterText: string | null
  context: SectionListContext
}

export function ConnectionSectionList({
  sections,
  emptyFilterText,
  context,
}: ConnectionSectionListProps) {
  return (
    <div className={styles.list}>
      {emptyFilterText && (
        <div className={styles.emptyState}>No connections match “{emptyFilterText}”</div>
      )}
      {sections.map((section) => (
        <ConnectionSectionGroup key={sectionKey(section)} section={section} context={context} />
      ))}
      <NewGroupInput groups={context.groups} />
    </div>
  )
}
