import { useEffect, type RefObject } from 'react'
import { isTargetWithin } from '../../../lib/input-events'

const FOCUSABLE_SELECTOR = 'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
const GRID_HOST_SELECTOR = '.glide-grid-host'

export function useKeepEditorFocusInPicker(
  pickerOpen: boolean,
  pickerPopupRef: RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    if (!pickerOpen) return
    const handleMouseDown = (event: MouseEvent) => {
      const isFocusable = isTargetWithin(event.target, FOCUSABLE_SELECTOR)
      if (!isFocusable) event.preventDefault()
    }
    const portalElement = pickerPopupRef.current
    if (!portalElement) return
    portalElement.addEventListener('mousedown', handleMouseDown)
    return () => {
      portalElement.removeEventListener('mousedown', handleMouseDown)
    }
  }, [pickerOpen, pickerPopupRef])
}

export function useClosePickerOnGridScroll(
  pickerOpen: boolean,
  closePicker: () => void,
  containerRef: RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    if (!pickerOpen) return
    const gridBody = containerRef.current?.closest(GRID_HOST_SELECTOR)
    if (!gridBody) return
    gridBody.addEventListener('scroll', closePicker)
    return () => gridBody.removeEventListener('scroll', closePicker)
  }, [pickerOpen, closePicker, containerRef])
}
