import type { ShortcutBinding } from '../../types/schema'

/**
 * Keys the command palette handles while it is open. The key handler and the
 * key hints (row `Tab` chip, footer) both read these, so the hints always show
 * the keys the palette really responds to.
 */
export const PALETTE_KEYS = {
  up: { key: 'ArrowUp', modifiers: [] },
  down: { key: 'ArrowDown', modifiers: [] },
  open: { key: 'Enter', modifiers: [] },
  columns: { key: 'Tab', modifiers: [] },
  close: { key: 'Escape', modifiers: [] },
} satisfies Record<string, ShortcutBinding>
