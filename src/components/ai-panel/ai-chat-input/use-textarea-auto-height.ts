import { useCallback, useEffect, type RefObject } from 'react'

const MIN_TEXTAREA_HEIGHT_PX = 32
const MAX_TEXTAREA_HEIGHT_PX = 140

export function useTextareaAutoHeight(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string
) {
  const adjustHeight = useCallback(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }
    if (value.length === 0) {
      element.style.height = `${MIN_TEXTAREA_HEIGHT_PX}px`
      return
    }
    element.style.height = 'auto'
    const borders = element.offsetHeight - element.clientHeight
    element.style.height = `${Math.min(
      Math.max(element.scrollHeight + borders, MIN_TEXTAREA_HEIGHT_PX),
      MAX_TEXTAREA_HEIGHT_PX
    )}px`
  }, [textareaRef, value])

  useEffect(() => {
    adjustHeight()
  }, [value, adjustHeight])

  const resetHeight = useCallback(() => {
    requestAnimationFrame(() => {
      const element = textareaRef.current
      if (element) {
        element.style.height = `${MIN_TEXTAREA_HEIGHT_PX}px`
      }
    })
  }, [textareaRef])

  return resetHeight
}
