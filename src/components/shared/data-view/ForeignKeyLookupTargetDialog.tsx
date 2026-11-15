import type { DataViewLocation } from '../../../types/shared-data-view'
import { FkLookupDialog } from '../FkLookupDialog'
import type { ForeignKeyLookup } from './use-foreign-key-lookup'

export interface ForeignKeyLookupTargetDialogProps<RowIdentity> {
  lookup: ForeignKeyLookup<RowIdentity>
  location: DataViewLocation | null
}

export function ForeignKeyLookupTargetDialog<RowIdentity>({
  lookup,
  location,
}: ForeignKeyLookupTargetDialogProps<RowIdentity>) {
  const { target } = lookup
  if (!target) return null
  if (!location) return null
  return (
    <FkLookupDialog
      isOpen={true}
      onClose={lookup.closeLookup}
      onApply={lookup.applyLookup}
      connectionId={location.connectionId}
      database={target.foreignKey.referencedDatabase || location.database}
      sourceTable={location.table}
      sourceColumn={target.sourceColumn}
      currentValue={target.currentValue}
      referencedTable={target.foreignKey.referencedTable}
      referencedColumn={target.foreignKey.referencedColumn}
      isReadOnly={lookup.isReadOnly}
    />
  )
}
