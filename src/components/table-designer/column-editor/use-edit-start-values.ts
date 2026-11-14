import { useRef } from 'react'
import { editStartKey, type ActiveCell } from '../column-editor-model'

export interface EditStartValues {
  editStartValue: (key: string) => string | undefined
  rememberEditStart: (cell: ActiveCell, value: string) => void
  forgetEditStart: (cell: ActiveCell) => void
}

export function useEditStartValues(): EditStartValues {
  const editStartValuesRef = useRef<Record<string, string>>({})
  return {
    editStartValue: (key) => editStartValuesRef.current[key],
    rememberEditStart: (cell, value) => {
      editStartValuesRef.current[editStartKey(cell)] = value
    },
    forgetEditStart: (cell) => {
      delete editStartValuesRef.current[editStartKey(cell)]
    },
  }
}
