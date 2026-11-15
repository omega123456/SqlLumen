import type { ReactNode } from 'react'
import { joinClassNames } from '../../../lib/class-names'

export type EditorMarkerKind = 'singleLine' | 'multiline' | 'json'

const MARKER_GROUP_FRAME = 'flex flex-none min-w-max justify-end gap-1 mr-px ml-auto'

const MARKER_GROUP_CLASSES: Record<EditorMarkerKind, string> = {
  singleLine: joinClassNames([MARKER_GROUP_FRAME, 'items-center']),
  multiline: joinClassNames([MARKER_GROUP_FRAME, 'items-center self-start']),
  json: joinClassNames([MARKER_GROUP_FRAME, 'items-start self-start']),
}

interface EditorMarkerGroupProps {
  kind: EditorMarkerKind
  children: ReactNode
}

export function EditorMarkerGroup({ kind, children }: EditorMarkerGroupProps) {
  return <div className={MARKER_GROUP_CLASSES[kind]}>{children}</div>
}
