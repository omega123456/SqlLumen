import type { ShortcutBinding } from '../../types/schema'

export const PALETTE_KEYS = {
  up: { key: 'ArrowUp', modifiers: [] },
  down: { key: 'ArrowDown', modifiers: [] },
  open: { key: 'Enter', modifiers: [] },
  columns: { key: 'Tab', modifiers: [] },
  close: { key: 'Escape', modifiers: [] },
} satisfies Record<string, ShortcutBinding>
