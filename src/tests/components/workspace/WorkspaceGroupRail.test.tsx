import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  RAIL_ITEM_TRANSITION_MS,
  RAIL_TOOLTIP_DELAY_MS,
  WorkspaceGroupRail,
} from '../../../components/workspace/WorkspaceGroupRail'
import { useTableDesignerStore } from '../../../stores/table-designer-store'
import { useObjectEditorStore } from '../../../stores/object-editor-store'
import type { WorkspaceTabStackGroup } from '../../../lib/workspace-tab-stacks'
import type { WorkspaceTab } from '../../../types/schema'

function queryTab(id: string): WorkspaceTab {
  return { id, type: 'query-editor', label: id, connectionId: 'conn-1' } as WorkspaceTab
}

function tableTab(id: string): WorkspaceTab {
  return {
    id,
    type: 'table-data',
    label: id,
    connectionId: 'conn-1',
    databaseName: 'mydb',
    objectName: id,
    objectType: 'table',
  } as WorkspaceTab
}

function schemaTab(id: string): WorkspaceTab {
  return {
    id,
    type: 'schema-info',
    label: id,
    connectionId: 'conn-1',
    databaseName: 'mydb',
    objectName: id,
    objectType: 'table',
  } as WorkspaceTab
}

const QUERIES: WorkspaceTabStackGroup = { key: 'queries', tabs: [queryTab('q1'), queryTab('q2')] }
const TABLES: WorkspaceTabStackGroup = { key: 'tables', tabs: [tableTab('t1')] }
const SCHEMA: WorkspaceTabStackGroup = { key: 'schema', tabs: [schemaTab('s1')] }

const HISTORY = {
  id: 'h1',
  type: 'history',
  label: 'History',
  connectionId: 'conn-1',
} as WorkspaceTab
const PROCESSLIST = {
  id: 'p1',
  type: 'processlist',
  label: 'Process list',
  connectionId: 'conn-1',
} as WorkspaceTab

const item = (key: string) => screen.getByTestId(`workspace-group-rail-item-${key}`)
const pinned = (type: string) => screen.getByTestId(`workspace-pinned-tab-${type}`)

beforeEach(() => {
  useTableDesignerStore.setState({ tabs: {} })
  useObjectEditorStore.setState({ tabs: {} })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WorkspaceGroupRail', () => {
  it('renders one tab per group with its icon, count and accessible name', () => {
    render(
      <WorkspaceGroupRail stackGroups={[QUERIES, TABLES]} value="queries" onSelect={vi.fn()} />
    )

    const rail = screen.getByTestId('workspace-group-rail')
    expect(rail).toHaveAttribute('role', 'tablist')
    expect(rail).toHaveAccessibleName('Tab groups')
    expect(within(rail).getAllByRole('tab')).toHaveLength(2)

    expect(item('queries')).toHaveAccessibleName('Queries, 2 tabs')
    expect(item('queries')).toHaveTextContent('2')
    expect(item('tables')).toHaveAccessibleName('Tables, 1 tab')
    expect(screen.getByTestId('workspace-stack-icon-queries')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-stack-icon-tables')).toBeInTheDocument()
  })

  it('marks the shown group selected and makes it the only tab stop', () => {
    render(<WorkspaceGroupRail stackGroups={[QUERIES, TABLES]} value="tables" onSelect={vi.fn()} />)

    expect(item('tables')).toHaveAttribute('aria-selected', 'true')
    expect(item('tables')).toHaveAttribute('data-selected')
    expect(item('tables')).toHaveAttribute('tabindex', '0')
    expect(item('queries')).toHaveAttribute('aria-selected', 'false')
    expect(item('queries')).toHaveAttribute('tabindex', '-1')
    expect(screen.getByTestId('workspace-group-rail-marker')).toBeVisible()
  })

  it('hides the marker and keeps the first item tabbable when no group is shown', () => {
    render(<WorkspaceGroupRail stackGroups={[QUERIES]} value={null} onSelect={vi.fn()} />)

    expect(screen.getByTestId('workspace-group-rail-marker')).not.toBeVisible()
    expect(item('queries')).toHaveAttribute('tabindex', '0')
    expect(item('queries')).toHaveAttribute('aria-selected', 'false')
  })

  it('slides the marker only after its first placement', () => {
    const { rerender } = render(
      <WorkspaceGroupRail stackGroups={[QUERIES, TABLES]} value="queries" onSelect={vi.fn()} />
    )
    const marker = screen.getByTestId('workspace-group-rail-marker')
    expect(marker).toHaveAttribute('data-animate', 'false')
    expect(marker.style.transform).toMatch(/^translateY\(/)

    rerender(
      <WorkspaceGroupRail stackGroups={[QUERIES, TABLES]} value="tables" onSelect={vi.fn()} />
    )
    expect(marker).toHaveAttribute('data-animate', 'true')
  })

  it('applies an extra class name', () => {
    render(
      <WorkspaceGroupRail
        stackGroups={[QUERIES]}
        value="queries"
        onSelect={vi.fn()}
        className="extra-rail"
      />
    )
    expect(screen.getByTestId('workspace-group-rail')).toHaveClass('extra-rail')
  })

  it('selects a group on click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <WorkspaceGroupRail stackGroups={[QUERIES, TABLES]} value="queries" onSelect={onSelect} />
    )

    await user.click(item('tables'))
    expect(onSelect).toHaveBeenCalledWith('tables')
  })

  it('moves the selection with the arrow keys, Home and End, wrapping at the ends', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <WorkspaceGroupRail
        stackGroups={[QUERIES, TABLES, SCHEMA]}
        value="queries"
        onSelect={onSelect}
      />
    )

    act(() => item('queries').focus())
    await user.keyboard('{ArrowDown}')
    expect(onSelect).toHaveBeenLastCalledWith('tables')
    expect(item('tables')).toHaveFocus()

    act(() => item('queries').focus())
    await user.keyboard('{ArrowUp}')
    expect(onSelect).toHaveBeenLastCalledWith('schema')
    expect(item('schema')).toHaveFocus()

    await user.keyboard('{Home}')
    expect(onSelect).toHaveBeenLastCalledWith('queries')
    expect(item('queries')).toHaveFocus()

    await user.keyboard('{End}')
    expect(onSelect).toHaveBeenLastCalledWith('schema')

    onSelect.mockClear()
    act(() => item('queries').focus())
    await user.keyboard('{Home}')
    expect(onSelect).not.toHaveBeenCalled()
    expect(item('queries')).toHaveFocus()

    await user.keyboard('a')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('hands focus to the group tabs with ArrowRight', async () => {
    const user = userEvent.setup()
    const onFocusMembers = vi.fn()
    render(
      <WorkspaceGroupRail
        stackGroups={[QUERIES, TABLES]}
        value="queries"
        onSelect={vi.fn()}
        onFocusMembers={onFocusMembers}
      />
    )

    act(() => item('tables').focus())
    await user.keyboard('{ArrowRight}')
    expect(onFocusMembers).toHaveBeenCalledWith('tables')
  })

  it('ignores ArrowRight when no focus handler is given', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<WorkspaceGroupRail stackGroups={[QUERIES]} value="queries" onSelect={onSelect} />)

    act(() => item('queries').focus())
    await user.keyboard('{ArrowRight}')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows the group name and count in a tooltip after hovering, and hides it on leave', () => {
    vi.useFakeTimers()
    render(
      <WorkspaceGroupRail stackGroups={[QUERIES, TABLES]} value="queries" onSelect={vi.fn()} />
    )

    fireEvent.mouseEnter(item('tables'))
    act(() => vi.advanceTimersByTime(RAIL_TOOLTIP_DELAY_MS - 1))
    expect(screen.queryByTestId('workspace-group-rail-tooltip')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1))
    const tooltip = screen.getByTestId('workspace-group-rail-tooltip')
    expect(tooltip).toHaveAttribute('role', 'tooltip')
    expect(tooltip).toHaveTextContent('Tables1 tab')

    fireEvent.mouseLeave(item('tables'))
    expect(screen.queryByTestId('workspace-group-rail-tooltip')).not.toBeInTheDocument()
  })

  it('hides the tooltip on click and cancels a pending one', () => {
    vi.useFakeTimers()
    const onSelect = vi.fn()
    render(
      <WorkspaceGroupRail stackGroups={[QUERIES, TABLES]} value="queries" onSelect={onSelect} />
    )

    fireEvent.mouseEnter(item('queries'))
    act(() => vi.advanceTimersByTime(RAIL_TOOLTIP_DELAY_MS))
    expect(screen.getByTestId('workspace-group-rail-tooltip')).toHaveTextContent('Queries2 tabs')

    fireEvent.click(item('queries'))
    expect(screen.queryByTestId('workspace-group-rail-tooltip')).not.toBeInTheDocument()

    fireEvent.mouseEnter(item('tables'))
    fireEvent.mouseEnter(item('queries'))
    fireEvent.click(item('queries'))
    act(() => vi.advanceTimersByTime(RAIL_TOOLTIP_DELAY_MS))
    expect(screen.queryByTestId('workspace-group-rail-tooltip')).not.toBeInTheDocument()
  })

  it('drops a pending tooltip when its group closes before the delay ends', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <WorkspaceGroupRail stackGroups={[QUERIES, TABLES]} value="queries" onSelect={vi.fn()} />
    )

    fireEvent.mouseEnter(item('tables'))
    rerender(<WorkspaceGroupRail stackGroups={[QUERIES]} value="queries" onSelect={vi.fn()} />)
    act(() => vi.advanceTimersByTime(RAIL_ITEM_TRANSITION_MS))
    act(() => vi.advanceTimersByTime(RAIL_TOOLTIP_DELAY_MS))
    expect(screen.queryByTestId('workspace-group-rail-tooltip')).not.toBeInTheDocument()
  })

  it('shows a dirty dot for groups with unsaved designer or editor changes', () => {
    const designerTab = {
      id: 'd1',
      type: 'table-designer',
      label: 'users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'users',
      mode: 'alter',
    } as WorkspaceTab
    const editorTab = {
      id: 'o1',
      type: 'object-editor',
      label: 'v_users',
      connectionId: 'conn-1',
      databaseName: 'mydb',
      objectName: 'v_users',
      objectType: 'view',
      mode: 'alter',
    } as WorkspaceTab
    const cleanEditorTab = { ...editorTab, id: 'o2' } as WorkspaceTab
    useTableDesignerStore.setState({
      tabs: { d1: { isDirty: true } } as unknown as ReturnType<
        typeof useTableDesignerStore.getState
      >['tabs'],
    })
    useObjectEditorStore.setState({
      tabs: {
        o1: { content: 'SELECT 2', originalContent: 'SELECT 1' },
        o2: { content: 'SELECT 1', originalContent: 'SELECT 1' },
      } as unknown as ReturnType<typeof useObjectEditorStore.getState>['tabs'],
    })

    const { rerender } = render(
      <WorkspaceGroupRail
        stackGroups={[
          { key: 'designers', tabs: [designerTab] },
          { key: 'objects', tabs: [editorTab] },
          QUERIES,
        ]}
        value="queries"
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByTestId('workspace-group-rail-dirty-designers')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-group-rail-dirty-objects')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-group-rail-dirty-queries')).not.toBeInTheDocument()

    rerender(
      <WorkspaceGroupRail
        stackGroups={[{ key: 'objects', tabs: [cleanEditorTab, { ...editorTab, id: 'o3' }] }]}
        value="objects"
        onSelect={vi.fn()}
      />
    )
    expect(screen.queryByTestId('workspace-group-rail-dirty-objects')).not.toBeInTheDocument()
  })

  it('fades a new group in and a closed group out before removing it', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <WorkspaceGroupRail stackGroups={[QUERIES]} value="queries" onSelect={vi.fn()} />
    )
    expect(item('queries')).not.toHaveAttribute('data-phase')

    rerender(
      <WorkspaceGroupRail stackGroups={[QUERIES, SCHEMA]} value="queries" onSelect={vi.fn()} />
    )
    expect(item('schema')).toHaveAttribute('data-phase', 'entering')
    act(() => vi.advanceTimersByTime(RAIL_ITEM_TRANSITION_MS))
    expect(item('schema')).not.toHaveAttribute('data-phase')

    rerender(<WorkspaceGroupRail stackGroups={[SCHEMA]} value="schema" onSelect={vi.fn()} />)
    const leaving = item('queries')
    expect(leaving).toHaveAttribute('data-phase', 'leaving')
    expect(leaving).toBeDisabled()
    expect(leaving).toHaveAttribute('aria-hidden', 'true')
    expect(leaving).not.toHaveAttribute('role')
    expect(leaving).toHaveTextContent('2')
    expect(item('schema')).toHaveAttribute('tabindex', '0')

    act(() => vi.advanceTimersByTime(RAIL_ITEM_TRANSITION_MS))
    expect(screen.queryByTestId('workspace-group-rail-item-queries')).not.toBeInTheDocument()
  })

  it('brings a leaving group back when it reopens during the fade', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <WorkspaceGroupRail stackGroups={[QUERIES, TABLES]} value="queries" onSelect={vi.fn()} />
    )

    rerender(<WorkspaceGroupRail stackGroups={[QUERIES]} value="queries" onSelect={vi.fn()} />)
    expect(item('tables')).toHaveAttribute('data-phase', 'leaving')

    rerender(
      <WorkspaceGroupRail stackGroups={[QUERIES, TABLES]} value="queries" onSelect={vi.fn()} />
    )
    expect(item('tables')).toHaveAttribute('data-phase', 'entering')
    expect(item('tables')).toHaveAttribute('role', 'tab')

    act(() => vi.advanceTimersByTime(RAIL_ITEM_TRANSITION_MS))
    expect(item('tables')).not.toHaveAttribute('data-phase')
  })

  it('keeps entering state on items that are still entering when another group changes', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <WorkspaceGroupRail stackGroups={[QUERIES]} value="queries" onSelect={vi.fn()} />
    )
    rerender(
      <WorkspaceGroupRail stackGroups={[QUERIES, TABLES]} value="queries" onSelect={vi.fn()} />
    )
    rerender(
      <WorkspaceGroupRail
        stackGroups={[QUERIES, TABLES, SCHEMA]}
        value="queries"
        onSelect={vi.fn()}
      />
    )
    expect(item('tables')).toHaveAttribute('data-phase', 'entering')
    expect(item('schema')).toHaveAttribute('data-phase', 'entering')
    act(() => vi.advanceTimersByTime(RAIL_ITEM_TRANSITION_MS))
    expect(item('tables')).not.toHaveAttribute('data-phase')
    expect(item('schema')).not.toHaveAttribute('data-phase')
  })

  describe('pinned tabs', () => {
    it('renders History and Process list as icon-only tabs after the groups', () => {
      render(
        <WorkspaceGroupRail
          stackGroups={[QUERIES]}
          value="queries"
          onSelect={vi.fn()}
          pinnedTabs={[HISTORY, PROCESSLIST]}
        />
      )

      const rail = screen.getByTestId('workspace-group-rail')
      expect(within(rail).getAllByRole('tab')).toHaveLength(3)
      expect(pinned('history')).toHaveAccessibleName('History')
      expect(pinned('history')).toHaveTextContent('')
      expect(pinned('processlist')).toHaveAccessibleName('Process list')
      expect(screen.getByTestId('workspace-group-rail-pinned')).toContainElement(pinned('history'))
      expect(
        item('queries').compareDocumentPosition(pinned('history')) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    it('takes the selection and tab stop from the shown group while selected', () => {
      render(
        <WorkspaceGroupRail
          stackGroups={[QUERIES]}
          value="queries"
          onSelect={vi.fn()}
          pinnedTabs={[HISTORY, PROCESSLIST]}
          activePinnedTabId="p1"
        />
      )

      expect(pinned('processlist')).toHaveAttribute('aria-selected', 'true')
      expect(pinned('processlist')).toHaveAttribute('tabindex', '0')
      expect(pinned('history')).toHaveAttribute('aria-selected', 'false')
      expect(item('queries')).toHaveAttribute('aria-selected', 'false')
      expect(item('queries')).toHaveAttribute('tabindex', '-1')
      expect(screen.getByTestId('workspace-group-rail-marker')).toBeVisible()
    })

    it('marks a pinned tab selected when no group is open', () => {
      render(
        <WorkspaceGroupRail
          stackGroups={[]}
          value={null}
          onSelect={vi.fn()}
          pinnedTabs={[HISTORY]}
          activePinnedTabId="h1"
        />
      )

      expect(pinned('history')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('workspace-group-rail-marker')).toBeVisible()
    })

    it('selects a pinned tab on click and shows its name in a tooltip', () => {
      vi.useFakeTimers()
      const onSelectPinned = vi.fn()
      render(
        <WorkspaceGroupRail
          stackGroups={[QUERIES]}
          value="queries"
          onSelect={vi.fn()}
          pinnedTabs={[HISTORY]}
          onSelectPinned={onSelectPinned}
        />
      )

      fireEvent.mouseEnter(pinned('history'))
      act(() => vi.advanceTimersByTime(RAIL_TOOLTIP_DELAY_MS))
      expect(screen.getByTestId('workspace-group-rail-tooltip')).toHaveTextContent(/^History$/)

      fireEvent.click(pinned('history'))
      expect(onSelectPinned).toHaveBeenCalledWith('h1')
      expect(screen.queryByTestId('workspace-group-rail-tooltip')).not.toBeInTheDocument()
    })

    it('moves through groups and pinned tabs with the arrow keys', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      const onSelectPinned = vi.fn()
      const onFocusMembers = vi.fn()
      render(
        <WorkspaceGroupRail
          stackGroups={[QUERIES]}
          value="queries"
          onSelect={onSelect}
          onFocusMembers={onFocusMembers}
          pinnedTabs={[HISTORY, PROCESSLIST]}
          onSelectPinned={onSelectPinned}
        />
      )

      act(() => item('queries').focus())
      await user.keyboard('{ArrowDown}')
      expect(onSelectPinned).toHaveBeenLastCalledWith('h1')
      expect(pinned('history')).toHaveFocus()

      await user.keyboard('{End}')
      expect(onSelectPinned).toHaveBeenLastCalledWith('p1')
      expect(pinned('processlist')).toHaveFocus()

      await user.keyboard('{ArrowRight}')
      expect(onFocusMembers).not.toHaveBeenCalled()
      expect(pinned('processlist')).toHaveFocus()

      await user.keyboard('{ArrowDown}')
      expect(onSelect).toHaveBeenLastCalledWith('queries')
      expect(item('queries')).toHaveFocus()
    })
  })
})
