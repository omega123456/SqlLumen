/** Middle-button auxclick for React `onAuxClick` — `fireEvent.auxClick` is not available in our RTL version. */
export function dispatchAuxClick(element: Element) {
  element.dispatchEvent(
    new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
  )
}
