import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabContextMenu } from '../../../components/shared/TabContextMenu'
import { PencilSimpleIcon } from '@phosphor-icons/react'

describe('TabContextMenu', () => {
  it('renders rename and move actions with disabled states', () => {
    const onClose = vi.fn()
    render(
      <TabContextMenu
        visible
        x={40}
        y={60}
        portalRoot={document.body}
        onClose={onClose}
        items={[
          {
            key: 'rename',
            label: 'Rename',
            icon: <PencilSimpleIcon size={14} weight="regular" />,
            onSelect: vi.fn(),
          },
          { key: 'move-left', label: 'Move Left', disabled: true, onSelect: vi.fn() },
          { key: 'move-right', label: 'Move Right', disabled: true, onSelect: vi.fn() },
        ]}
      />
    )

    expect(screen.getByTestId('tab-context-menu-item-rename')).toBeEnabled()
    expect(screen.getByTestId('tab-context-menu-item-move-left')).toBeDisabled()
    expect(screen.getByTestId('tab-context-menu-item-move-right')).toBeDisabled()
    expect(
      screen.getByTestId('tab-context-menu-item-rename').querySelector('svg')
    ).toBeInTheDocument()
  })

  it('calls action and closes when an enabled item is selected', async () => {
    const onClose = vi.fn()
    const onRename = vi.fn()
    const user = userEvent.setup()
    render(
      <TabContextMenu
        visible
        x={40}
        y={60}
        portalRoot={document.body}
        onClose={onClose}
        items={[{ key: 'rename', label: 'Rename', onSelect: onRename }]}
      />
    )

    await user.click(screen.getByTestId('tab-context-menu-item-rename'))
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape and outside click', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <div>
        <button type="button">Outside</button>
        <TabContextMenu
          visible
          x={40}
          y={60}
          portalRoot={document.body}
          onClose={onClose}
          items={[{ key: 'rename', label: 'Rename', onSelect: vi.fn() }]}
        />
      </div>
    )

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(2)
    })
  })
})
