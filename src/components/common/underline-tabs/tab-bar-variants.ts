import type { ReactNode } from 'react'

export type UnderlineTabBarVariant = 'default' | 'selector' | 'document'

export type UnderlineTabVariant = UnderlineTabBarVariant | 'connection'

export type UnderlineTabRowHeight = 'default' | 'tall'

export interface UnderlineTabBarProps {
  children: ReactNode
  className?: string
  'data-testid'?: string
  prefix?: ReactNode
  suffix?: ReactNode
  scrollable?: boolean
  variant?: UnderlineTabBarVariant
  rowHeight?: UnderlineTabRowHeight
}
