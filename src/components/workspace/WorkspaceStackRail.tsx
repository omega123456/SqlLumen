import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CaretDownIcon, PlusIcon } from '@phosphor-icons/react'
import type { WorkspaceTab } from '../../types/schema'
import {
  WORKSPACE_TAB_STACK_META,
  type WorkspaceTabStackGroup,
  type WorkspaceTabStackKey,
} from '../../lib/workspace-tab-stacks'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { UnderlineTab } from '../common/UnderlineTabs'
import { IconButton } from '../common/IconButton'
import {
  getWorkspaceStackIconDescriptor,
  getWorkspaceTabIconDescriptor,
} from './workspace-tab-icons'
import styles from './WorkspaceTabs.module.css'

type CompactMode = 'full' | 'short' | 'icon-count' | 'icon'

export interface WorkspaceStackRailProps {
  stackGroups: WorkspaceTabStackGroup[]
  activeStackKey: WorkspaceTabStackKey | null
  pinnedTabs: WorkspaceTab[]
  activeTabId: string | null
  connectionActive?: boolean
  onActivateStack: (stackKey: WorkspaceTabStackKey) => void
  onActivatePinnedTab: (tabId: string) => void
  onOpenQueryTab: () => void
  onFocusStackMembers?: (stackKey: WorkspaceTabStackKey) => void
}

function getCompactMode(width: number, chipCount: number): CompactMode {
  if (chipCount <= 0 || width <= 0) {
    return 'full'
  }

  const perChipWidth = width / chipCount
  if (perChipWidth >= 106) {
    return 'full'
  }
  if (perChipWidth >= 78) {
    return 'short'
  }
  if (perChipWidth >= 56) {
    return 'icon-count'
  }
  return 'icon'
}

export function WorkspaceStackRail({
  stackGroups,
  activeStackKey,
  pinnedTabs,
  activeTabId,
  connectionActive = true,
  onActivateStack,
  onActivatePinnedTab,
  onOpenQueryTab,
  onFocusStackMembers,
}: WorkspaceStackRailProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [compactMode, setCompactMode] = useState<CompactMode>('full')
  const designerTabs = useTableDesignerStore((state) => state.tabs)
  const objectEditorTabs = useObjectEditorStore((state) => state.tabs)
  const focusOrder = useMemo(
    () => [
      ...stackGroups.map((group) => `workspace-stack-chip-${group.key}`),
      'new-query-tab-button',
      ...pinnedTabs.map((tab) => `workspace-pinned-tab-${tab.type}`),
    ],
    [pinnedTabs, stackGroups]
  )

  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    const updateMode = () => {
      setCompactMode(getCompactMode(root.clientWidth, stackGroups.length + pinnedTabs.length + 1))
    }

    updateMode()
    const observer = new ResizeObserver(updateMode)
    observer.observe(root)
    return () => observer.disconnect()
  }, [pinnedTabs.length, stackGroups.length])

  const moveFocus = (currentId: string, direction: -1 | 1) => {
    const currentIndex = focusOrder.findIndex((focusId) => focusId === currentId)
    if (currentIndex < 0) {
      return
    }

    const nextIndex = (currentIndex + direction + focusOrder.length) % focusOrder.length
    const nextId = focusOrder[nextIndex]
    const nextEl = nextId
      ? rootRef.current?.querySelector<HTMLElement>(`[data-testid="${nextId}"]`)
      : null
    nextEl?.focus()
  }

  const handleKeyNav = (event: KeyboardEvent<HTMLElement>, currentId: string) => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        moveFocus(currentId, -1)
        break
      case 'ArrowRight':
        event.preventDefault()
        moveFocus(currentId, 1)
        break
      case 'Home':
        event.preventDefault()
        rootRef.current?.querySelector<HTMLElement>(`[data-testid="${focusOrder[0]}"]`)?.focus()
        break
      case 'End':
        event.preventDefault()
        rootRef.current
          ?.querySelector<HTMLElement>(`[data-testid="${focusOrder[focusOrder.length - 1]}"]`)
          ?.focus()
        break
      case 'ArrowDown':
        {
          const focusedStackKey = stackGroups.find(
            (group) => `workspace-stack-chip-${group.key}` === currentId
          )?.key
          const targetStackKey = focusedStackKey ?? activeStackKey
          if (targetStackKey === null) {
            return
          }

          event.preventDefault()
          onFocusStackMembers?.(targetStackKey)
        }
        break
      default:
        break
    }
  }

  const renderCount = (count: number) => {
    if (compactMode === 'icon') {
      return null
    }

    return <span className={styles.stackChipCount}>{count}</span>
  }

  const getPinnedTabCompactLabel = (tab: WorkspaceTab) => {
    if (compactMode === 'icon') {
      return ''
    }
    if (compactMode === 'full') {
      return tab.label
    }
    if (tab.type === 'history') {
      return 'Hist'
    }
    if (tab.type === 'processlist') {
      return 'Proc'
    }
    return tab.label
  }

  return (
    <div
      ref={rootRef}
      className={styles.stackRail}
      data-compact-mode={compactMode}
      data-testid="workspace-tabs"
    >
      <div className={styles.stackRailGroups}>
        {stackGroups.map((group) => {
          const meta = WORKSPACE_TAB_STACK_META[group.key]
          const { IconComponent, testId } = getWorkspaceStackIconDescriptor(group.key)
          const chipTestId = `workspace-stack-chip-${group.key}`
          const isActive = activeStackKey === group.key
          const label =
            compactMode === 'full'
              ? meta.label
              : compactMode === 'short'
                ? meta.shortLabel
                : compactMode === 'icon'
                  ? ''
                  : undefined

          return (
            <UnderlineTab
              key={group.key}
              active={isActive}
              className={styles.stackChip}
              data-testid={chipTestId}
              aria-label={`${meta.label} stack, ${group.tabs.length} tabs`}
              title={meta.iconOnlyLabel}
              autoScrollOnActive={connectionActive}
              onClick={() => onActivateStack(group.key)}
              onKeyDown={(event) => handleKeyNav(event, chipTestId)}
            >
              <span className={styles.stackChipLabel}>
                <IconComponent
                  size={13}
                  weight="regular"
                  aria-hidden={true}
                  data-testid={testId}
                  className={styles.stackChipIcon}
                />
                {label ? <span>{label}</span> : null}
                {renderCount(group.tabs.length)}
                <CaretDownIcon
                  size={11}
                  weight="bold"
                  aria-hidden={true}
                  className={styles.stackChipCaret}
                />
                {group.tabs.some((tab) => {
                  if (tab.type === 'table-designer') {
                    return designerTabs[tab.id]?.isDirty ?? false
                  }
                  if (tab.type === 'object-editor') {
                    const editorTab = objectEditorTabs[tab.id]
                    return editorTab ? editorTab.content !== editorTab.originalContent : false
                  }
                  return false
                }) ? (
                  <span className={styles.stackChipDirty} aria-hidden="true">
                    ●
                  </span>
                ) : null}
              </span>
            </UnderlineTab>
          )
        })}
      </div>

      <div className={styles.stackRailPinned}>
        <IconButton
          size="md"
          className={styles.newTabButton}
          title="New Query Tab"
          aria-label="New Query Tab"
          onClick={onOpenQueryTab}
          onKeyDown={(event) => handleKeyNav(event, 'new-query-tab-button')}
          data-testid="new-query-tab-button"
        >
          <PlusIcon size={16} weight="bold" />
        </IconButton>
        {pinnedTabs.map((tab) => {
          const { IconComponent, testId } = getWorkspaceTabIconDescriptor(tab)
          const pinnedTestId = `workspace-pinned-tab-${tab.type}`

          return (
            <UnderlineTab
              key={tab.id}
              active={tab.id === activeTabId}
              className={styles.stackChip}
              data-testid={pinnedTestId}
              aria-label={tab.label}
              title={tab.label}
              autoScrollOnActive={connectionActive}
              onClick={() => onActivatePinnedTab(tab.id)}
              onKeyDown={(event) => handleKeyNav(event, pinnedTestId)}
            >
              <span className={styles.stackChipLabel}>
                <IconComponent
                  size={13}
                  weight="regular"
                  aria-hidden={true}
                  data-testid={testId}
                  className={styles.stackChipIcon}
                />
                {getPinnedTabCompactLabel(tab) ? (
                  <span>{getPinnedTabCompactLabel(tab)}</span>
                ) : null}
              </span>
            </UnderlineTab>
          )
        })}
      </div>
    </div>
  )
}
