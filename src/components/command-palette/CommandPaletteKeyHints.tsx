import type { ShortcutBinding } from '../../types/schema'
import { shortcutLabelParts } from '../../lib/shortcut-labels'
import { PALETTE_KEYS } from './palette-keys'
import styles from './CommandPaletteKeyHints.module.css'

interface KeyCapsProps {
  binding: ShortcutBinding
  className: string
}

/** One `<kbd>` per label part of a binding (e.g. `Ctrl`, `K`). */
export function KeyCaps({ binding, className }: KeyCapsProps) {
  return (
    <>
      {shortcutLabelParts(binding).map((part) => (
        <kbd key={part} className={className}>
          {part}
        </kbd>
      ))}
    </>
  )
}

/** Trailing hint on table rows (prototype `.pi-row .kd`): "Search columns [Tab]". */
export function SearchColumnsHint() {
  return (
    <span className={styles.rowHint}>
      Search columns
      <KeyCaps binding={PALETTE_KEYS.columns} className={styles.rowKey} />
    </span>
  )
}

export interface CommandPaletteFooterProps {
  /** Tab only scopes to columns from the object list, so the hint hides in column scope. */
  showColumnsHint: boolean
}

/** Key-hint footer (prototype `.pal .ft`). */
export function CommandPaletteFooter({ showColumnsHint }: CommandPaletteFooterProps) {
  return (
    <div className={styles.footer} data-testid="command-palette-footer">
      <span>
        <KeyCaps binding={PALETTE_KEYS.up} className={styles.footerKey} />
        <KeyCaps binding={PALETTE_KEYS.down} className={styles.footerKey} />
        Move
      </span>
      <span>
        <KeyCaps binding={PALETTE_KEYS.open} className={styles.footerKey} />
        Open
      </span>
      {showColumnsHint ? (
        <span>
          <KeyCaps binding={PALETTE_KEYS.columns} className={styles.footerKey} />
          Columns
        </span>
      ) : null}
      <span>
        <KeyCaps binding={PALETTE_KEYS.close} className={styles.footerKey} />
        Close
      </span>
    </div>
  )
}
