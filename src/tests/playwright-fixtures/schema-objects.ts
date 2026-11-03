/** Object names returned by `list_schema_objects`, keyed by object type. */
export const DEFAULT_SCHEMA_OBJECTS_BY_TYPE: Record<string, string[]> = {
  table: ['users', 'orders', 'products', 'bit_test'],
  view: ['user_stats_view'],
  procedure: ['sp_get_orders'],
  function: ['fn_calculate_total'],
  trigger: ['trg_before_insert'],
  event: [],
}
