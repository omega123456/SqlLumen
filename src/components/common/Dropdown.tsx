import { useRef } from 'react'
import { Listbox } from '@headlessui/react'
import { DropdownBody } from './dropdown/DropdownBody'
import { useDropdownController, useDropdownElements } from './dropdown/use-dropdown-controller'
import { isMultiSelect, type DropdownComponentProps } from './dropdown/dropdown-types'

export type { DropdownOption, DropdownProps } from './dropdown/dropdown-types'

export function Dropdown<TValue extends string = string>({
  ref: forwardedRef,
  ...props
}: DropdownComponentProps<TValue>) {
  const openRef = useRef(false)
  const elements = useDropdownElements()
  const controller = useDropdownController(props, {
    elements: elements,
    forwardedRef: forwardedRef,
    openRef: openRef,
  })
  const renderBody = ({ open }: { open: boolean }) => {
    openRef.current = open
    return (
      <DropdownBody open={open} dropdownProps={props} controller={controller} elements={elements} />
    )
  }

  if (isMultiSelect(props)) {
    return (
      <Listbox value={props.value} onChange={props.onChange} disabled={props.disabled} multiple>
        {renderBody}
      </Listbox>
    )
  }

  return (
    <Listbox value={props.value} onChange={props.onChange} disabled={props.disabled}>
      {renderBody}
    </Listbox>
  )
}
