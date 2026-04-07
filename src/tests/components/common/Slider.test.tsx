import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Slider } from '../../../components/common/Slider'

describe('Slider', () => {
  it('renders with correct min/max/step attributes', () => {
    render(<Slider min={0} max={100} step={1} value={50} onChange={() => {}} />)

    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '100')
    expect(slider).toHaveAttribute('step', '1')
  })

  it('shows current value', () => {
    render(<Slider min={0} max={100} step={1} value={42} onChange={() => {}} />)

    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('onChange called with correct value on input event', () => {
    const onChange = vi.fn()
    render(<Slider min={0} max={100} step={1} value={50} onChange={onChange} />)

    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '75' } })

    expect(onChange).toHaveBeenCalledWith(75)
  })

  it('has accessible aria attributes', () => {
    render(<Slider min={10} max={200} step={5} value={50} onChange={() => {}} label="Font Size" />)

    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-label', 'Font Size')
    expect(slider).toHaveAttribute('aria-valuenow', '50')
    expect(slider).toHaveAttribute('aria-valuemin', '10')
    expect(slider).toHaveAttribute('aria-valuemax', '200')
  })

  it('renders label when provided', () => {
    render(<Slider min={0} max={100} step={1} value={50} onChange={() => {}} label="Volume" />)

    expect(screen.getByText('Volume')).toBeInTheDocument()
  })

  it('disabled state works', () => {
    render(<Slider min={0} max={100} step={1} value={50} onChange={() => {}} disabled />)

    const slider = screen.getByRole('slider')
    expect(slider).toBeDisabled()
  })

  it('uses default aria-label when no label prop', () => {
    render(<Slider min={0} max={100} step={1} value={50} onChange={() => {}} />)

    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-label', 'Slider')
  })

  it('accepts className prop', () => {
    const { container } = render(
      <Slider min={0} max={100} step={1} value={50} onChange={() => {}} className="custom" />
    )

    expect(container.firstChild).toHaveClass('custom')
  })
})
