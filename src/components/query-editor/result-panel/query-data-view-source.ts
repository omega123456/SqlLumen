import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import type { DataViewSource, DataViewTestIds } from '../../shared/data-view/data-view-source'
import type { ViewMode } from '../../../types/shared-data-view'

const QUERY_RESULT_MODES: readonly ViewMode[] = ['grid', 'form', 'text']

const QUERY_RESULT_TEST_IDS: DataViewTestIds = {
  grid: 'result-grid',
  form: 'result-form-view',
  text: 'result-text-view',
  toolbar: 'result-toolbar',
  restoreOverlay: 'query-result-restore-overlay',
  busyOverlay: 'query-result-sort-overlay',
}

export interface QueryDataViewSourceInputs {
  ref: DataViewSurfaceRef
  isActive: boolean
  isTruncated: boolean
  canEdit: boolean
}

export function queryDataViewSource({
  ref,
  isActive,
  isTruncated,
  canEdit,
}: QueryDataViewSourceInputs): DataViewSource {
  return {
    ref: ref,
    testIds: QUERY_RESULT_TEST_IDS,
    isActive: isActive,
    isTruncated: isTruncated,
    capabilities: {
      modes: QUERY_RESULT_MODES,
      canEdit: canEdit,
      rowActions: true,
      blobViewDisabledReason: null,
      paging: null,
      reload: null,
      columnJump: null,
    },
  }
}
