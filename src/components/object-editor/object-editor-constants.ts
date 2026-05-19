import type { EditableObjectType } from '../../types/schema'

export const OBJECT_TYPE_LABELS: Record<EditableObjectType, string> = {
  procedure: 'Stored Procedure',
  function: 'Function',
  trigger: 'Trigger',
  event: 'Event',
  view: 'View',
}
