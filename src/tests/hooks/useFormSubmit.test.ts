import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { FormEvent } from 'react'
import { useFormSubmit } from '../../hooks/useFormSubmit'

function buildSubmitEvent(): FormEvent<HTMLFormElement> {
  const form = document.createElement('form')
  const nativeEvent = new Event('submit', { cancelable: true })
  return {
    currentTarget: form,
    target: form,
    nativeEvent: nativeEvent,
    preventDefault: vi.fn(),
  } as unknown as FormEvent<HTMLFormElement>
}

describe('useFormSubmit', () => {
  it('prevents the native submit and runs the handler', () => {
    const submit = vi.fn()
    const { result } = renderHook(() => useFormSubmit(submit))
    const submitEvent = buildSubmitEvent()

    result.current(submitEvent)

    expect(submitEvent.preventDefault).toHaveBeenCalled()
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('keeps the same callback while the handler is unchanged', () => {
    const submit = vi.fn(async () => {})
    const { result, rerender } = renderHook(() => useFormSubmit(submit))
    const firstCallback = result.current

    rerender()

    expect(result.current).toBe(firstCallback)
  })
})
