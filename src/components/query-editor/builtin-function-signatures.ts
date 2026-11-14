import type { BuiltinFunctionSignature } from './builtin-function-signatures/signature-types'
import { NUMERIC_FUNCTION_SIGNATURES } from './builtin-function-signatures/numeric-functions'
import { STRING_FUNCTION_ASCII_TO_LTRIM_SIGNATURES } from './builtin-function-signatures/string-functions-ascii-to-ltrim'
import { STRING_FUNCTION_MAKE_SET_TO_WEIGHT_STRING_SIGNATURES } from './builtin-function-signatures/string-functions-make-set-to-weight-string'
import { DATE_TIME_FUNCTION_ADD_MONTHS_TO_MONTHNAME_SIGNATURES } from './builtin-function-signatures/date-time-functions-add-months-to-monthname'
import { DATE_TIME_FUNCTION_NOW_TO_YEARWEEK_SIGNATURES } from './builtin-function-signatures/date-time-functions-now-to-yearweek'
import { AGGREGATE_FUNCTION_SIGNATURES } from './builtin-function-signatures/aggregate-functions'
import { WINDOW_FUNCTION_SIGNATURES } from './builtin-function-signatures/window-functions'
import { CONTROL_FLOW_FUNCTION_SIGNATURES } from './builtin-function-signatures/control-flow-functions'
import { COMPARISON_FUNCTION_SIGNATURES } from './builtin-function-signatures/comparison-functions'
import { INFORMATION_FUNCTION_SIGNATURES } from './builtin-function-signatures/information-functions'
import { ENCRYPTION_FUNCTION_SIGNATURES } from './builtin-function-signatures/encryption-functions'
import { JSON_FUNCTION_SIGNATURES } from './builtin-function-signatures/json-functions'
import { DYNAMIC_COLUMN_FUNCTION_SIGNATURES } from './builtin-function-signatures/dynamic-column-functions'
import { NETWORK_FUNCTION_SIGNATURES } from './builtin-function-signatures/network-functions'
import { LOCK_FUNCTION_SIGNATURES } from './builtin-function-signatures/lock-functions'
import { SEQUENCE_FUNCTION_SIGNATURES } from './builtin-function-signatures/sequence-functions'
import { UUID_FUNCTION_SIGNATURES } from './builtin-function-signatures/uuid-functions'
import { REPLICATION_FUNCTION_SIGNATURES } from './builtin-function-signatures/replication-functions'
import { GALERA_FUNCTION_SIGNATURES } from './builtin-function-signatures/galera-functions'
import { SPIDER_ENGINE_FUNCTION_SIGNATURES } from './builtin-function-signatures/spider-engine-functions'
import { VECTOR_FUNCTION_SIGNATURES } from './builtin-function-signatures/vector-functions'
import { XML_FUNCTION_SIGNATURES } from './builtin-function-signatures/xml-functions'
import { MISC_UTILITY_FUNCTION_SIGNATURES } from './builtin-function-signatures/misc-utility-functions'
import { GEOMETRY_CONSTRUCTORS_SIGNATURES } from './builtin-function-signatures/geometry-constructors'
import { LEGACY_GEOMETRY_FUNCTION_AREA_TO_MBRCONTAINS_SIGNATURES } from './builtin-function-signatures/legacy-geometry-functions-area-to-mbrcontains'
import { LEGACY_GEOMETRY_FUNCTION_MBRCOVEREDBY_TO_Y_SIGNATURES } from './builtin-function-signatures/legacy-geometry-functions-mbrcoveredby-to-y'
import { ST_GEOMETRY_FUNCTION_ST_AREA_TO_ST_GEOMETRYFROMWKB_SIGNATURES } from './builtin-function-signatures/st-geometry-functions-st-area-to-st-geometryfromwkb'
import { ST_GEOMETRY_FUNCTION_ST_GEOMETRYN_TO_ST_MULTIPOINTFROMTEXT_SIGNATURES } from './builtin-function-signatures/st-geometry-functions-st-geometryn-to-st-multipointfromtext'
import { ST_GEOMETRY_FUNCTION_ST_MULTIPOINTFROMWKB_TO_ST_Y_SIGNATURES } from './builtin-function-signatures/st-geometry-functions-st-multipointfromwkb-to-st-y'
import { MYSQL_SPECIFIC_FUNCTION_ANY_VALUE_TO_RANDOM_BYTES_SIGNATURES } from './builtin-function-signatures/mysql-specific-functions-any-value-to-random-bytes'
import { MYSQL_SPECIFIC_FUNCTION_REGEXP_INSTR_TO_WAIT_FOR_EXECUTED_GTID_SET_SIGNATURES } from './builtin-function-signatures/mysql-specific-functions-regexp-instr-to-wait-for-executed-gtid-set'

export type { BuiltinFunctionSignature }

export function getSignatureLabel(name: string, signature: BuiltinFunctionSignature): string {
  if (signature.label) return signature.label
  const parameterList = signature.parameters.map((parameter) => parameter.label).join(', ')
  return `${name}(${parameterList})`
}
export const BUILTIN_FUNCTION_SIGNATURES: Map<string, BuiltinFunctionSignature> = new Map([
  ...NUMERIC_FUNCTION_SIGNATURES,
  ...STRING_FUNCTION_ASCII_TO_LTRIM_SIGNATURES,
  ...STRING_FUNCTION_MAKE_SET_TO_WEIGHT_STRING_SIGNATURES,
  ...DATE_TIME_FUNCTION_ADD_MONTHS_TO_MONTHNAME_SIGNATURES,
  ...DATE_TIME_FUNCTION_NOW_TO_YEARWEEK_SIGNATURES,
  ...AGGREGATE_FUNCTION_SIGNATURES,
  ...WINDOW_FUNCTION_SIGNATURES,
  ...CONTROL_FLOW_FUNCTION_SIGNATURES,
  ...COMPARISON_FUNCTION_SIGNATURES,
  ...INFORMATION_FUNCTION_SIGNATURES,
  ...ENCRYPTION_FUNCTION_SIGNATURES,
  ...JSON_FUNCTION_SIGNATURES,
  ...DYNAMIC_COLUMN_FUNCTION_SIGNATURES,
  ...NETWORK_FUNCTION_SIGNATURES,
  ...LOCK_FUNCTION_SIGNATURES,
  ...SEQUENCE_FUNCTION_SIGNATURES,
  ...UUID_FUNCTION_SIGNATURES,
  ...REPLICATION_FUNCTION_SIGNATURES,
  ...GALERA_FUNCTION_SIGNATURES,
  ...SPIDER_ENGINE_FUNCTION_SIGNATURES,
  ...VECTOR_FUNCTION_SIGNATURES,
  ...XML_FUNCTION_SIGNATURES,
  ...MISC_UTILITY_FUNCTION_SIGNATURES,
  ...GEOMETRY_CONSTRUCTORS_SIGNATURES,
  ...LEGACY_GEOMETRY_FUNCTION_AREA_TO_MBRCONTAINS_SIGNATURES,
  ...LEGACY_GEOMETRY_FUNCTION_MBRCOVEREDBY_TO_Y_SIGNATURES,
  ...ST_GEOMETRY_FUNCTION_ST_AREA_TO_ST_GEOMETRYFROMWKB_SIGNATURES,
  ...ST_GEOMETRY_FUNCTION_ST_GEOMETRYN_TO_ST_MULTIPOINTFROMTEXT_SIGNATURES,
  ...ST_GEOMETRY_FUNCTION_ST_MULTIPOINTFROMWKB_TO_ST_Y_SIGNATURES,
  ...MYSQL_SPECIFIC_FUNCTION_ANY_VALUE_TO_RANDOM_BYTES_SIGNATURES,
  ...MYSQL_SPECIFIC_FUNCTION_REGEXP_INSTR_TO_WAIT_FOR_EXECUTED_GTID_SET_SIGNATURES,
])

export function getBuiltinSignature(
  name: string
): (BuiltinFunctionSignature & { label: string }) | undefined {
  const key = name.toUpperCase()
  const signature = BUILTIN_FUNCTION_SIGNATURES.get(key)
  if (!signature) return undefined
  return { ...signature, label: getSignatureLabel(key, signature) }
}
