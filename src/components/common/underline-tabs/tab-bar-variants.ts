import type { ReactNode } from 'react'
import styles from '../UnderlineTabs.module.css'

/**
 * - default: WinUI SelectorBar — centred 16×3 accent pill (dialog and view tabs)
 * - selector: tab-group row — semibold text, accent icon and a 2px accent underline
 * - document: rounded 32px document tabs in a 38px strip; the selected tab joins the content below
 */
export type UnderlineTabVariant = 'default' | 'selector' | 'document'

export const BAR_VARIANT_CLASS: Record<UnderlineTabVariant, string> = {
  default: '',
  selector: styles.barSelector,
  document: styles.barDocument,
}

export interface UnderlineTabBarProps {
  children: ReactNode
  className?: string
  'data-testid'?: string
  /** Content rendered before the tab area, outside its scroll box (e.g. a group picker). */
  prefix?: ReactNode
  /** Content rendered outside the scrollable tab area (e.g. pinned tabs, action buttons). */
  suffix?: ReactNode
  /** When true, tabs scroll horizontally with a hidden scrollbar. While they overflow
   * (`data-overflowing`), count chips at each end show and scroll to the hidden tabs. */
  scrollable?: boolean
  variant?: UnderlineTabVariant
}
