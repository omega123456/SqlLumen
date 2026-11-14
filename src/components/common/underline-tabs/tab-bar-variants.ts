import type { ReactNode } from 'react'
import styles from '../UnderlineTabs.module.css'

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
  prefix?: ReactNode
  suffix?: ReactNode
  scrollable?: boolean
  variant?: UnderlineTabVariant
}
