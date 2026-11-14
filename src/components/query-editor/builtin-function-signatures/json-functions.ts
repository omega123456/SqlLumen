import type { BuiltinSignatureEntry } from './signature-types'

export const JSON_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'JSON_ARRAY',
    {
      parameters: [
        { label: 'val', documentation: 'A value to include in the JSON array.' },
        { label: '...' },
      ],
      returnType: 'JSON',
      documentation: 'Evaluates a list of values and returns a JSON array containing those values.',
    },
  ],
  [
    'JSON_ARRAY_APPEND',
    {
      parameters: [{ label: 'json_doc' }, { label: 'path' }, { label: 'val' }, { label: '...' }],
      returnType: 'JSON',
      documentation: 'Appends values to the end of the indicated arrays within a JSON document.',
    },
  ],
  [
    'JSON_ARRAY_INSERT',
    {
      parameters: [{ label: 'json_doc' }, { label: 'path' }, { label: 'val' }, { label: '...' }],
      returnType: 'JSON',
      documentation: 'Inserts into a JSON array within a JSON document.',
    },
  ],
  [
    'JSON_ARRAY_INTERSECT',
    {
      parameters: [{ label: 'array1' }, { label: 'array2' }],
      returnType: 'JSON',
      documentation: 'Returns the intersection of two JSON arrays (MariaDB).',
    },
  ],
  [
    'JSON_COMPACT',
    {
      parameters: [{ label: 'json_doc' }],
      returnType: 'JSON',
      documentation: 'Returns a compact representation of the JSON document (MariaDB).',
    },
  ],
  [
    'JSON_CONTAINS',
    {
      parameters: [
        { label: 'target', documentation: 'The JSON document to search.' },
        { label: 'candidate', documentation: 'The JSON value to search for.' },
        {
          label: 'path (optional)',
          documentation: 'A JSON path to restrict the search.',
        },
      ],
      returnType: 'INT',
      documentation:
        'Returns 1 if the given candidate JSON is contained in the target JSON document.',
    },
  ],
  [
    'JSON_CONTAINS_PATH',
    {
      parameters: [
        { label: 'json_doc' },
        { label: 'one_or_all' },
        { label: 'path' },
        { label: '...' },
      ],
      returnType: 'INT',
      documentation: 'Returns 1 if a JSON document contains data at the specified path or paths.',
    },
  ],
  [
    'JSON_DEPTH',
    {
      parameters: [{ label: 'json_doc' }],
      returnType: 'INT',
      documentation: 'Returns the maximum depth of a JSON document.',
    },
  ],
  [
    'JSON_DETAILED',
    {
      parameters: [{ label: 'json_doc' }],
      returnType: 'JSON',
      documentation: 'Returns detailed pretty-printed JSON (MariaDB).',
    },
  ],
  [
    'JSON_EQUALS',
    {
      parameters: [{ label: 'json_doc1' }, { label: 'json_doc2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the two JSON documents are equal (MariaDB).',
    },
  ],
  [
    'JSON_EXISTS',
    {
      parameters: [{ label: 'json_doc' }, { label: 'path' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the specified path exists in the JSON document (MariaDB).',
    },
  ],
  [
    'JSON_EXTRACT',
    {
      parameters: [
        { label: 'json_doc', documentation: 'The JSON document.' },
        { label: 'path', documentation: 'A JSON path expression.' },
        { label: '...' },
      ],
      returnType: 'JSON',
      documentation: 'Returns data from a JSON document selected by the path arguments.',
    },
  ],
  [
    'JSON_INSERT',
    {
      parameters: [{ label: 'json_doc' }, { label: 'path' }, { label: 'val' }, { label: '...' }],
      returnType: 'JSON',
      documentation: 'Inserts data into a JSON document.',
    },
  ],
  [
    'JSON_KEY_VALUE',
    {
      parameters: [{ label: 'json_doc' }, { label: 'path' }],
      returnType: 'JSON',
      documentation: 'Returns key-value pairs from a JSON document (MariaDB).',
    },
  ],
  [
    'JSON_KEYS',
    {
      parameters: [{ label: 'json_doc' }],
      returnType: 'JSON',
      documentation: 'Returns the keys from the top-level value of a JSON object as a JSON array.',
    },
  ],
  [
    'JSON_LENGTH',
    {
      parameters: [
        { label: 'json_doc', documentation: 'The JSON document.' },
        {
          label: 'path (optional)',
          documentation: 'A JSON path expression.',
        },
      ],
      returnType: 'INT',
      documentation: 'Returns the length of a JSON document.',
    },
  ],
  [
    'JSON_LOOSE',
    {
      parameters: [{ label: 'json_doc' }],
      returnType: 'JSON',
      documentation: 'Returns a loosely formatted JSON document (MariaDB).',
    },
  ],
  [
    'JSON_MERGE',
    {
      label: 'JSON_MERGE(json_doc, json_doc, ...)',
      parameters: [{ label: 'json_doc' }, { label: '...' }],
      returnType: 'JSON',
      documentation: 'Merges two or more JSON documents. Deprecated alias for JSON_MERGE_PRESERVE.',
    },
  ],
  [
    'JSON_MERGE_PATCH',
    {
      parameters: [{ label: 'json_doc1' }, { label: 'json_doc2' }, { label: '...' }],
      returnType: 'JSON',
      documentation: 'Performs an RFC 7396 compliant merge of two or more JSON documents.',
    },
  ],
  [
    'JSON_MERGE_PRESERVE',
    {
      parameters: [{ label: 'json_doc1' }, { label: 'json_doc2' }, { label: '...' }],
      returnType: 'JSON',
      documentation: 'Merges two or more JSON documents, preserving duplicate keys.',
    },
  ],
  [
    'JSON_NORMALIZE',
    {
      parameters: [{ label: 'json_doc' }],
      returnType: 'JSON',
      documentation: 'Normalizes a JSON document (MariaDB).',
    },
  ],
  [
    'JSON_OBJECT',
    {
      parameters: [
        { label: 'key', documentation: 'The key string.' },
        { label: 'val', documentation: 'The value for the key.' },
        { label: '...' },
      ],
      returnType: 'JSON',
      documentation: 'Evaluates a list of key-value pairs and returns a JSON object.',
    },
  ],
  [
    'JSON_OBJECT_FILTER_KEYS',
    {
      parameters: [{ label: 'json_doc' }, { label: 'keys' }],
      returnType: 'JSON',
      documentation: 'Returns a JSON object with only the specified keys (MariaDB).',
    },
  ],
  [
    'JSON_OBJECT_TO_ARRAY',
    {
      parameters: [{ label: 'json_doc' }],
      returnType: 'JSON',
      documentation: 'Converts a JSON object to an array of key-value pairs (MariaDB).',
    },
  ],
  [
    'JSON_OVERLAPS',
    {
      parameters: [{ label: 'json_doc1' }, { label: 'json_doc2' }],
      returnType: 'INT',
      documentation:
        'Compares two JSON documents, returns 1 if they have any key-value pairs or array elements in common.',
    },
  ],
  [
    'JSON_PRETTY',
    {
      parameters: [{ label: 'json_val' }],
      returnType: 'JSON',
      documentation: 'Provides pretty-printing of JSON values in an easy-to-read format.',
    },
  ],
  [
    'JSON_QUERY',
    {
      parameters: [{ label: 'json_doc' }, { label: 'path' }],
      returnType: 'JSON',
      documentation: 'Returns an object or array from a JSON document (MariaDB).',
    },
  ],
  [
    'JSON_QUOTE',
    {
      parameters: [{ label: 'string' }],
      returnType: 'JSON',
      documentation: 'Quotes a string as a JSON value by wrapping it with double quote characters.',
    },
  ],
  [
    'JSON_REMOVE',
    {
      parameters: [{ label: 'json_doc' }, { label: 'path' }, { label: '...' }],
      returnType: 'JSON',
      documentation: 'Removes data from a JSON document and returns the result.',
    },
  ],
  [
    'JSON_REPLACE',
    {
      parameters: [{ label: 'json_doc' }, { label: 'path' }, { label: 'val' }, { label: '...' }],
      returnType: 'JSON',
      documentation: 'Replaces existing values in a JSON document and returns the result.',
    },
  ],
  [
    'JSON_SCHEMA_VALID',
    {
      parameters: [{ label: 'schema' }, { label: 'document' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the document validates against the JSON schema, 0 otherwise.',
    },
  ],
  [
    'JSON_SEARCH',
    {
      parameters: [{ label: 'json_doc' }, { label: 'one_or_all' }, { label: 'search_str' }],
      returnType: 'JSON',
      documentation: 'Returns the path to the given string within a JSON document.',
    },
  ],
  [
    'JSON_SET',
    {
      parameters: [{ label: 'json_doc' }, { label: 'path' }, { label: 'val' }, { label: '...' }],
      returnType: 'JSON',
      documentation: 'Inserts or updates data in a JSON document and returns the result.',
    },
  ],
  [
    'JSON_TABLE',
    {
      parameters: [{ label: 'expr' }, { label: 'path COLUMNS (...)' }],
      returnType: 'TABLE',
      documentation: 'Extracts data from a JSON document and returns it as a relational table.',
    },
  ],
  [
    'JSON_TYPE',
    {
      parameters: [{ label: 'json_val', documentation: 'The JSON value.' }],
      returnType: 'VARCHAR',
      documentation: 'Returns a string indicating the type of a JSON value.',
    },
  ],
  [
    'JSON_UNQUOTE',
    {
      parameters: [{ label: 'json_val', documentation: 'The JSON value to unquote.' }],
      returnType: 'VARCHAR',
      documentation: 'Unquotes a JSON value and returns the result as a string.',
    },
  ],
  [
    'JSON_VALID',
    {
      parameters: [{ label: 'val', documentation: 'The value to validate as JSON.' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the argument is a valid JSON document, 0 otherwise.',
    },
  ],
  [
    'JSON_VALUE',
    {
      parameters: [{ label: 'json_doc' }, { label: 'path' }],
      returnType: 'mixed',
      documentation:
        'Extracts a scalar value from a JSON document at the location pointed to by the path.',
    },
  ],
]
