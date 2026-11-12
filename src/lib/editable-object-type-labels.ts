import type { EditableObjectType } from '../types/schema'

export const EDITABLE_OBJECT_TYPE_LABELS: Record<EditableObjectType, string> = {
  view: 'View',
  procedure: 'Procedure',
  function: 'Function',
  trigger: 'Trigger',
  event: 'Event',
}
