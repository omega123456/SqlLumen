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
          { key: 'move-left', label: 'Move left', disabled: true, onSelect: vi.fn() },
          { key: 'move-right', label: 'Move right', disabled: true, onSelect: vi.fn() },
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

  it('uses absolute positioning when portaled into an open dialog', async () => {
    const dialog = document.createElement('dialog')
    dialog.open = true
    document.body.appendChild(dialog)

    try {
      render(
        <TabContextMenu
          visible
          x={40}
          y={60}
          portalRoot={dialog}
          onClose={vi.fn()}
          items={[{ key: 'rename', label: 'Rename', onSelect: vi.fn() }]}
        />
      )

      await waitFor(() => {
        expect(screen.getByTestId('tab-context-menu')).toHaveStyle({ position: 'absolute' })
      })
    } finally {
      dialog.remove()
    }
  })

  it('renders a shortcut hint and a separator after an item', () => {
    render(
      <TabContextMenu
        visible
        x={40}
        y={60}
        portalRoot={document.body}
        onClose={vi.fn()}
        items={[
          {
            key: 'reveal',
            label: 'Reveal in object browser',
            shortcut: 'Shift F1',
            separatorAfter: true,
            onSelect: vi.fn(),
          },
          { key: 'rename', label: 'Rename', onSelect: vi.fn() },
        ]}
      />
    )

    const reveal = screen.getByTestId('tab-context-menu-item-reveal')
    expect(reveal.querySelector('.ui-context-menu__shortcut')).toHaveTextContent('Shift F1')
    expect(reveal.nextElementSibling).toHaveClass('ui-context-menu__separator')
    expect(reveal.nextElementSibling?.nextElementSibling).toBe(
      screen.getByTestId('tab-context-menu-item-rename')
    )
    expect(
      screen.getByTestId('tab-context-menu-item-rename').querySelector('.ui-context-menu__shortcut')
    ).toBeNull()
  })
})
