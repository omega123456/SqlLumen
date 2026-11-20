import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DataViewModeSwitch } from '../../../../components/shared/data-view/DataViewModeSwitch'
import type { ViewMode } from '../../../../types/shared-data-view'

function renderSwitch(mode: ViewMode) {
  return (
    <DataViewModeSwitch
      mode={mode}
      grid={<div data-testid="grid-view" />}
      form={<div data-testid="form-view" />}
      text={<div data-testid="text-view" />}
    />
  )
}

describe('DataViewModeSwitch', () => {
  it('keeps grid and text mounted while hidden and mounts form only while shown', () => {
    const { rerender } = render(renderSwitch('grid'))
    const grid = screen.getByTestId('grid-view')
    expect(screen.queryByTestId('form-view')).not.toBeInTheDocument()

    rerender(renderSwitch('form'))
    expect(screen.getByTestId('form-view')).toBeVisible()
    expect(grid).not.toBeVisible()

    rerender(renderSwitch('text'))
    const text = screen.getByTestId('text-view')
    expect(text).toBeVisible()
    expect(screen.queryByTestId('form-view')).not.toBeInTheDocument()

    rerender(renderSwitch('grid'))
    expect(screen.getByTestId('grid-view')).toBe(grid)
    expect(grid).toBeVisible()
    expect(text).not.toBeVisible()

    rerender(renderSwitch('text'))
    expect(screen.getByTestId('text-view')).toBe(text)
    expect(text).toBeVisible()
  })

  it('renders nothing for text mode when no text view is given', () => {
    render(
      <DataViewModeSwitch
        mode="text"
        grid={<div data-testid="grid-view" />}
        form={<div data-testid="form-view" />}
      />
    )
    expect(screen.queryByTestId('grid-view')).not.toBeInTheDocument()
    expect(screen.queryByTestId('form-view')).not.toBeInTheDocument()
  })
})
