import { useCallback, type FormEvent } from 'react'

export function useFormSubmit(
  submit: () => void | Promise<void>
): (event: FormEvent<HTMLFormElement>) => void {
  return useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void submit()
    },
    [submit]
  )
}
