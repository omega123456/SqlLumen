import type { ReactNode } from 'react'

export type UnderlineTabVariant = 'default' | 'selector' | 'document'

export type UnderlineTabRowHeight = 'default' | 'tall'

export interface UnderlineTabBarProps {
  children: ReactNode
  className?: string
  'data-testid'?: string
  prefix?: ReactNode
  suffix?: ReactNode
  scrollable?: boolean
  variant?: UnderlineTabVariant
  rowHeight?: UnderlineTabRowHeight
}
