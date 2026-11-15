import { useMemo } from 'react'
import type { AutoSizeConfig } from '../../../types/shared-data-view'
import {
  useResultColumnDescriptors,
  type ResultColumnDescriptorInputs,
} from '../result-column-descriptors'
import { computeResultColumnWidth } from './result-grid-model'

export function useResultGridColumns(inputs: ResultColumnDescriptorInputs) {
  const { editMode, editableColumnMap, editColumnBindings } = inputs
  const { resolvedColumns, descriptors } = useResultColumnDescriptors(inputs)

  const autoSizeConfig: AutoSizeConfig = useMemo(() => {
    const sizingInputs = {
      resolvedColumns: resolvedColumns,
      editableColumnMap: editableColumnMap,
      editMode: editMode,
      editColumnBindings: editColumnBindings,
    }
    return {
      enabled: true,
      computeWidth: (column, gridRows) => computeResultColumnWidth(sizingInputs, column, gridRows),
    }
  }, [editColumnBindings, editMode, editableColumnMap, resolvedColumns])

  return { gridColumns: descriptors, autoSizeConfig: autoSizeConfig }
}
