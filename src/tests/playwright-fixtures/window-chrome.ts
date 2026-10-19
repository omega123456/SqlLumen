import type { WindowBackdrop } from '../../lib/window-commands'

/** The web build has no native window, so it always renders the solid (non-Mica) base. */
export const DEFAULT_WINDOW_BACKDROP: WindowBackdrop = 'solid'
