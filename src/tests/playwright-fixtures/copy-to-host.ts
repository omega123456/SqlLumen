import type { CopyProgress, CopyableObjects } from '../../lib/copy-to-host-commands'

export const COPY_TO_HOST_TARGET_DATABASES = ['ecommerce_db', 'analytics_db', 'staging_db']

export const COPY_TO_HOST_OBJECTS: CopyableObjects = {
  tables: [
    { name: 'users', estimatedRows: 1240 },
    { name: 'orders', estimatedRows: 5820 },
    { name: 'audit_log', estimatedRows: 18422 },
  ],
  procedures: ['sp_refresh_user_rollups'],
  functions: ['fn_customer_lifetime_value'],
  triggers: ['trg_orders_after_insert'],
  events: ['ev_prune_audit_log'],
}

export const COPY_TO_HOST_START_JOB_ID = 'copy-job-1'

export const COPY_TO_HOST_PROGRESS_RUNNING: CopyProgress = {
  jobId: COPY_TO_HOST_START_JOB_ID,
  status: 'running',
  objectsTotal: 4,
  objectsDone: 2,
  currentObject: 'orders',
  currentObjectType: 'table',
  rowsTotal: 5820,
  rowsDone: 2140,
  errorMessage: null,
  cancelRequested: false,
}

export const COPY_TO_HOST_PROGRESS_COMPLETED: CopyProgress = {
  jobId: COPY_TO_HOST_START_JOB_ID,
  status: 'completed',
  objectsTotal: 4,
  objectsDone: 4,
  currentObject: null,
  currentObjectType: null,
  rowsTotal: null,
  rowsDone: null,
  errorMessage: null,
  cancelRequested: false,
}
