import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { dispatchAuxClick } from '../../helpers/dispatch-aux-click'
import userEvent from '@testing-library/user-event'
import { UnderlineTabBar, UnderlineTab } from '../../../components/common/UnderlineTabs'

describe('UnderlineTabs', () => {
  it('renders simple tab and toggles data-active', () => {
    const { rerender } = render(
      <UnderlineTabBar>
        <UnderlineTab data-testid="t1" active={false} onClick={() => {}}>
          One
        </UnderlineTab>
      </UnderlineTabBar>
    )

    const btn = screen.getByTestId('t1')
    expect(btn).not.toHaveAttribute('data-active')
    expect(btn).toHaveTextContent('One')

    rerender(
      <UnderlineTabBar>
        <UnderlineTab data-testid="t1" active onClick={() => {}}>
          One
        </UnderlineTab>
      </UnderlineTabBar>
    )
    expect(screen.getByTestId('t1')).toHaveAttribute('data-active')
  })

  it('renders split tab with suffix and marks active on cell', () => {
    render(
      <UnderlineTabBar>
        <UnderlineTab
          active
          data-testid="cell"
          onSelect={() => {}}
          prefix={<span data-testid="pfx">•</span>}
          suffix={
            <button type="button" aria-label="Close">
              ×
            </button>
          }
        >
          Label
        </UnderlineTab>
      </UnderlineTabBar>
    )

    expect(screen.getByTestId('cell')).toHaveAttribute('data-active')
    expect(screen.getByTestId('pfx')).toBeInTheDocument()
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Label/ })).toBeInTheDocument()
  })

  it('applies custom indicator color as CSS variable on simple tab', () => {
    render(
      <UnderlineTabBar>
        <UnderlineTab data-testid="t1" active indicatorColor="#ff00aa" onClick={() => {}}>
          X
        </UnderlineTab>
      </UnderlineTabBar>
    )

    const el = screen.getByTestId('t1')
    expect(el.style.getPropertyValue('--underline-tab-indicator').trim()).toBe('#ff00aa')
  })

  it('invokes onClick for simple and onSelect for split label', async () => {
    const user = userEvent.setup()
    const onSimple = vi.fn()
    const onSelect = vi.fn()

    render(
      <UnderlineTabBar>
        <UnderlineTab onClick={onSimple}>A</UnderlineTab>
        <UnderlineTab onSelect={onSelect} suffix={<span />}>
          B
        </UnderlineTab>
      </UnderlineTabBar>
    )

    await user.click(screen.getByRole('button', { name: 'A' }))
    expect(onSimple).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'B' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('invokes onAuxClick for simple and split tab cell', () => {
    const onAuxSimple = vi.fn()
    const onAuxSplit = vi.fn()

    render(
      <UnderlineTabBar>
        <UnderlineTab data-testid="simple" onClick={() => {}} onAuxClick={onAuxSimple}>
          A
        </UnderlineTab>
        <UnderlineTab
          data-testid="split-cell"
          onSelect={() => {}}
          onAuxClick={onAuxSplit}
          suffix={<span />}
        >
          B
        </UnderlineTab>
      </UnderlineTabBar>
    )

    dispatchAuxClick(screen.getByTestId('simple'))
    expect(onAuxSimple).toHaveBeenCalledTimes(1)

    dispatchAuxClick(screen.getByTestId('split-cell'))
    expect(onAuxSplit).toHaveBeenCalledTimes(1)
  })
})
