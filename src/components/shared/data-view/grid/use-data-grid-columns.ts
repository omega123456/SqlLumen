import { useMemo } from 'react'
import type { AutoSizeConfig } from '../../../../types/shared-data-view'
import {
  useDataColumnDescriptors,
  type DataColumnDescriptorInputs,
} from '../data-column-descriptors'
import { computeDataColumnWidth } from './data-grid-model'

export function useDataGridColumns(inputs: DataColumnDescriptorInputs) {
  const { editTarget } = inputs
  const { resolvedColumns, descriptors } = useDataColumnDescriptors(inputs)

  const autoSizeConfig: AutoSizeConfig = useMemo(() => {
    const sizingInputs = { resolvedColumns: resolvedColumns, editTarget: editTarget }
    return {
      enabled: true,
      computeWidth: (column, gridRows) => computeDataColumnWidth(sizingInputs, column, gridRows),
    }
  }, [editTarget, resolvedColumns])

  return { gridColumns: descriptors, autoSizeConfig: autoSizeConfig }
}
