import type { BuiltinSignatureEntry } from './signature-types'

export const STRING_FUNCTION_MAKE_SET_TO_WEIGHT_STRING_SIGNATURES: readonly BuiltinSignatureEntry[] =
  [
    [
      'MAKE_SET',
      {
        parameters: [{ label: 'bits' }, { label: 'str1' }, { label: 'str2' }, { label: '...' }],
        returnType: 'VARCHAR',
        documentation:
          'Returns a comma-separated set string of the strings that have the corresponding bit in bits set.',
      },
    ],
    [
      'MID',
      {
        parameters: [
          { label: 'str', documentation: 'The source string.' },
          {
            label: 'pos',
            documentation: 'The starting position (1-indexed). Negative values count from the end.',
          },
          {
            label: 'len (optional)',
            documentation:
              'The length of the substring to return. If omitted, returns from pos to end of string.',
          },
        ],
        returnType: 'VARCHAR',
        documentation:
          'Returns the substring from string str starting at position pos. Synonym for SUBSTRING().',
      },
    ],
    [
      'NAME_CONST',
      {
        parameters: [{ label: 'name' }, { label: 'value' }],
        returnType: 'mixed',
        documentation: 'Returns the given value and causes the column to have the given name.',
      },
    ],
    [
      'NATURAL_SORT_KEY',
      {
        parameters: [{ label: 'str' }],
        returnType: 'VARCHAR',
        documentation: 'Returns a key for natural-order sorting of str (MariaDB).',
      },
    ],
    [
      'OCT',
      {
        parameters: [{ label: 'N' }],
        returnType: 'VARCHAR',
        documentation: 'Returns a string representation of the octal value of N.',
      },
    ],
    [
      'OCTET_LENGTH',
      {
        parameters: [{ label: 'str' }],
        returnType: 'INT',
        documentation: 'Synonym for LENGTH().',
      },
    ],
    [
      'ORD',
      {
        parameters: [{ label: 'str' }],
        returnType: 'INT',
        documentation: 'Returns the character code for the leftmost character of str.',
      },
    ],
    [
      'POSITION',
      {
        parameters: [
          {
            label: 'substr IN str',
            documentation:
              'The substring to find and the string to search within, using the IN keyword syntax.',
          },
        ],
        returnType: 'INT',
        documentation: 'Returns position of substr in str. Syntax: POSITION(substr IN str)',
      },
    ],
    [
      'QUOTE',
      {
        parameters: [{ label: 'str' }],
        returnType: 'VARCHAR',
        documentation: 'Quotes a string to produce a properly escaped SQL data value.',
      },
    ],
    [
      'REPEAT',
      {
        parameters: [
          { label: 'str', documentation: 'The string to repeat.' },
          { label: 'count', documentation: 'Number of times to repeat.' },
        ],
        returnType: 'VARCHAR',
        documentation: 'Returns a string consisting of str repeated count times.',
      },
    ],
    [
      'REPLACE',
      {
        parameters: [
          { label: 'str', documentation: 'The original string.' },
          { label: 'from_str', documentation: 'The substring to replace.' },
          { label: 'to_str', documentation: 'The replacement string.' },
        ],
        returnType: 'VARCHAR',
        documentation: 'Returns str with all occurrences of from_str replaced by to_str.',
      },
    ],
    [
      'REVERSE',
      {
        parameters: [{ label: 'str', documentation: 'The string to reverse.' }],
        returnType: 'VARCHAR',
        documentation: 'Returns str with the order of the characters reversed.',
      },
    ],
    [
      'RIGHT',
      {
        parameters: [
          { label: 'str', documentation: 'The source string.' },
          { label: 'len', documentation: 'Number of characters.' },
        ],
        returnType: 'VARCHAR',
        documentation: 'Returns the rightmost len characters from str.',
      },
    ],
    [
      'RPAD',
      {
        parameters: [
          { label: 'str', documentation: 'The source string.' },
          { label: 'len', documentation: 'Target length.' },
          { label: 'padstr', documentation: 'The padding string.' },
        ],
        returnType: 'VARCHAR',
        documentation: 'Returns str, right-padded with padstr to a length of len characters.',
      },
    ],
    [
      'RTRIM',
      {
        parameters: [{ label: 'str', documentation: 'The string to trim.' }],
        returnType: 'VARCHAR',
        documentation: 'Returns str with trailing space characters removed.',
      },
    ],
    [
      'SOUNDEX',
      {
        parameters: [{ label: 'str' }],
        returnType: 'VARCHAR',
        documentation: 'Returns a soundex string from str.',
      },
    ],
    [
      'SPACE',
      {
        parameters: [{ label: 'N', documentation: 'The number of spaces.' }],
        returnType: 'VARCHAR',
        documentation: 'Returns a string consisting of N space characters.',
      },
    ],
    [
      'STRCMP',
      {
        parameters: [{ label: 'expr1' }, { label: 'expr2' }],
        returnType: 'INT',
        documentation: 'Returns 0 if strings are the same, -1 if expr1 < expr2, 1 otherwise.',
      },
    ],
    [
      'SUBSTR',
      {
        parameters: [
          { label: 'str', documentation: 'The source string.' },
          {
            label: 'pos',
            documentation: 'The starting position (1-indexed). Negative values count from the end.',
          },
          {
            label: 'len (optional)',
            documentation:
              'The length of the substring to return. If omitted, returns from pos to end of string.',
          },
        ],
        returnType: 'VARCHAR',
        documentation:
          'Returns the substring from string str starting at position pos. Synonym for SUBSTRING().',
      },
    ],
    [
      'SUBSTRING',
      {
        parameters: [
          { label: 'str', documentation: 'The source string.' },
          {
            label: 'pos',
            documentation: 'The starting position (1-indexed). Negative values count from the end.',
          },
          {
            label: 'len (optional)',
            documentation:
              'The length of the substring to return. If omitted, returns from pos to end of string.',
          },
        ],
        returnType: 'VARCHAR',
        documentation: 'Returns the substring from string str starting at position pos.',
      },
    ],
    [
      'SUBSTRING_INDEX',
      {
        parameters: [{ label: 'str' }, { label: 'delim' }, { label: 'count' }],
        returnType: 'VARCHAR',
        documentation: 'Returns the substring from str before count occurrences of delim.',
      },
    ],
    [
      'TO_BASE64',
      {
        parameters: [{ label: 'str' }],
        returnType: 'VARCHAR',
        documentation: 'Converts the argument to a base-64 encoded string.',
      },
    ],
    [
      'FROM_BASE64',
      {
        parameters: [{ label: 'str' }],
        returnType: 'VARBINARY',
        documentation: 'Decodes the base-64 encoded string and returns a binary string.',
      },
    ],
    [
      'TRIM',
      {
        parameters: [{ label: 'str', documentation: 'The string to trim whitespace from.' }],
        returnType: 'VARCHAR',
        documentation:
          'Removes leading/trailing spaces. Also: TRIM([BOTH|LEADING|TRAILING] remstr FROM str)',
      },
    ],
    [
      'UCASE',
      {
        parameters: [{ label: 'str', documentation: 'The string to convert.' }],
        returnType: 'VARCHAR',
        documentation: 'Synonym for UPPER().',
      },
    ],
    [
      'UNCOMPRESS',
      {
        parameters: [{ label: 'string_to_uncompress' }],
        returnType: 'VARBINARY',
        documentation: 'Uncompresses a string compressed by COMPRESS().',
      },
    ],
    [
      'UNCOMPRESSED_LENGTH',
      {
        parameters: [{ label: 'compressed_string' }],
        returnType: 'INT',
        documentation: 'Returns the length a compressed string had before compression.',
      },
    ],
    [
      'UNHEX',
      {
        parameters: [{ label: 'str', documentation: 'A hexadecimal string to decode.' }],
        returnType: 'VARBINARY',
        documentation:
          'Interprets each pair of hex digits in str as a number and converts to the character.',
      },
    ],
    [
      'UPPER',
      {
        parameters: [{ label: 'str', documentation: 'The string to convert.' }],
        returnType: 'VARCHAR',
        documentation: 'Returns str with all characters changed to uppercase.',
      },
    ],
    [
      'WEIGHT_STRING',
      {
        parameters: [{ label: 'str' }],
        returnType: 'VARBINARY',
        documentation:
          'Returns the weight string for str. Also: WEIGHT_STRING(str AS CHAR(N)|AS BINARY(N))',
      },
    ],
  ]
