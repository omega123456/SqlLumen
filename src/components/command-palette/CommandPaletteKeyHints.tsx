import type { ShortcutBinding } from '../../types/schema'
import { shortcutLabelParts } from '../../lib/shortcut-labels'
import { PALETTE_KEYS } from './palette-keys'

type KeyCapPlacement = 'row' | 'footer'

const KEY_CAP_CLASSES: Record<KeyCapPlacement, string> = {
  row: 'block rounded-bar border border-b-2 border-light-stroke-card px-1.25 font-body text-size-key-hint leading-normal dark:border-dark-stroke-card',
  footer:
    'mr-1 rounded-bar border border-light-stroke-card px-1 font-body text-size-key-hint leading-normal dark:border-dark-stroke-card',
}

interface KeyCapsProps {
  binding: ShortcutBinding
  placement: KeyCapPlacement
}

export function KeyCaps({ binding, placement }: KeyCapsProps) {
  return (
    <>
      {shortcutLabelParts(binding).map((part) => (
        <kbd key={part} className={KEY_CAP_CLASSES[placement]}>
          {part}
        </kbd>
      ))}
    </>
  )
}

export function SearchColumnsHint() {
  return (
    <span className="flex items-center gap-1.5 text-size-caption leading-5 whitespace-nowrap text-light-outline dark:text-dark-outline">
      Search columns
      <KeyCaps binding={PALETTE_KEYS.columns} placement="row" />
    </span>
  )
}

export interface CommandPaletteFooterProps {
  showColumnsHint: boolean
}

export function CommandPaletteFooter({ showColumnsHint }: CommandPaletteFooterProps) {
  return (
    <div
      className="flex shrink-0 gap-4 border-t border-light-stroke-divider bg-light-surface px-4 py-2 text-size-caption leading-5 text-light-outline dark:border-dark-stroke-divider dark:bg-dark-surface dark:text-dark-outline"
      data-testid="command-palette-footer"
    >
      <span>
        <KeyCaps binding={PALETTE_KEYS.up} placement="footer" />
        <KeyCaps binding={PALETTE_KEYS.down} placement="footer" />
        Move
      </span>
      <span>
        <KeyCaps binding={PALETTE_KEYS.open} placement="footer" />
        Open
      </span>
      {showColumnsHint ? (
        <span>
          <KeyCaps binding={PALETTE_KEYS.columns} placement="footer" />
          Columns
        </span>
      ) : null}
      <span>
        <KeyCaps binding={PALETTE_KEYS.close} placement="footer" />
        Close
      </span>
    </div>
  )
}
