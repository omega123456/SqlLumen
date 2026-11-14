import type { BuiltinSignatureEntry } from './signature-types'

export const STRING_FUNCTION_ASCII_TO_LTRIM_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'ASCII',
    {
      parameters: [
        { label: 'str', documentation: 'The string; returns ASCII value of first character.' },
      ],
      returnType: 'INT',
      documentation: 'Returns the numeric value of the leftmost character of str.',
    },
  ],
  [
    'BIN',
    {
      parameters: [{ label: 'N' }],
      returnType: 'VARCHAR',
      documentation: 'Returns a string representation of the binary value of N.',
    },
  ],
  [
    'BINARY',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARBINARY',
      documentation: 'Casts the string to a binary string.',
    },
  ],
  [
    'BIT_LENGTH',
    {
      parameters: [{ label: 'str' }],
      returnType: 'INT',
      documentation: 'Returns the length of str in bits.',
    },
  ],
  [
    'CAST',
    {
      parameters: [
        {
          label: 'expr AS type',
          documentation:
            'expr: The value to cast. type: The target type (e.g. CHAR, SIGNED, DECIMAL, DATE, JSON).',
        },
      ],
      returnType: 'mixed',
      documentation: 'Converts a value to a specified type. Also: CAST(expr AS type ARRAY)',
    },
  ],
  [
    'CHAR',
    {
      parameters: [{ label: 'N', documentation: 'ASCII code value.' }, { label: '...' }],
      returnType: 'VARCHAR',
      documentation:
        'Returns the character for each integer passed. Also: CHAR(N, ... USING charset)',
    },
  ],
  [
    'CHAR_LENGTH',
    {
      parameters: [{ label: 'str', documentation: 'The string to measure.' }],
      returnType: 'INT',
      documentation: 'Returns the length of str in characters.',
    },
  ],
  [
    'CHARACTER_LENGTH',
    {
      parameters: [{ label: 'str' }],
      returnType: 'INT',
      documentation: 'Synonym for CHAR_LENGTH().',
    },
  ],
  [
    'CHARSET',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the character set of the string argument.',
    },
  ],
  [
    'CHR',
    {
      parameters: [{ label: 'N' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the character for integer N (MariaDB synonym for CHAR(N)).',
    },
  ],
  [
    'CONCAT',
    {
      parameters: [
        { label: 'str1', documentation: 'The first string to concatenate.' },
        { label: 'str2', documentation: 'The second string to concatenate.' },
        { label: '...', documentation: 'Additional strings to concatenate.' },
      ],
      returnType: 'VARCHAR',
      documentation: 'Returns the string that results from concatenating the arguments.',
    },
  ],
  [
    'CONCAT_WS',
    {
      parameters: [{ label: 'separator' }, { label: 'str1' }, { label: 'str2' }, { label: '...' }],
      returnType: 'VARCHAR',
      documentation: 'Returns concatenation with separator. First argument is the separator.',
    },
  ],
  [
    'CONVERT',
    {
      parameters: [
        { label: 'expr', documentation: 'The value to convert.' },
        { label: 'type', documentation: 'The target type.' },
      ],
      returnType: 'mixed',
      documentation:
        'Converts a value to a specified type. Also: CONVERT(expr USING transcoding_name)',
    },
  ],
  [
    'ELT',
    {
      parameters: [{ label: 'N' }, { label: 'str1' }, { label: 'str2' }, { label: '...' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the Nth element of the list of strings.',
    },
  ],
  [
    'EXPORT_SET',
    {
      parameters: [
        { label: 'bits' },
        { label: 'on' },
        { label: 'off' },
        { label: 'separator' },
        { label: 'number_of_bits' },
      ],
      returnType: 'VARCHAR',
      documentation: 'Returns a string where for every bit set in bits, on is used; otherwise off.',
    },
  ],
  [
    'FIELD',
    {
      parameters: [{ label: 'str' }, { label: 'str1' }, { label: 'str2' }, { label: '...' }],
      returnType: 'INT',
      documentation: 'Returns the index (position) of str in the str1, str2, ... list.',
    },
  ],
  [
    'FIND_IN_SET',
    {
      parameters: [{ label: 'str' }, { label: 'strlist' }],
      returnType: 'INT',
      documentation: 'Returns the index position of str in a comma-separated strlist.',
    },
  ],
  [
    'FORMAT',
    {
      parameters: [
        { label: 'X', documentation: 'The numeric value.' },
        { label: 'D', documentation: 'Number of decimal places.' },
        { label: 'locale (optional)', documentation: 'Locale for formatting.' },
      ],
      returnType: 'VARCHAR',
      documentation: 'Formats number X to D decimal places and returns it as a string.',
    },
  ],
  [
    'FORMAT_BYTES',
    {
      parameters: [{ label: 'count' }],
      returnType: 'VARCHAR',
      documentation: 'Converts a byte count to a human-readable format with units.',
    },
  ],
  [
    'FORMAT_PICO_TIME',
    {
      parameters: [{ label: 'time_val' }],
      returnType: 'VARCHAR',
      documentation: 'Converts a picosecond time value to a human-readable format.',
    },
  ],
  [
    'HEX',
    {
      parameters: [
        {
          label: 'N_or_S',
          documentation: 'The string or numeric value to convert to hexadecimal.',
        },
      ],
      returnType: 'VARCHAR',
      documentation:
        'For a numeric argument returns the hex string; for a string returns hex representation.',
    },
  ],
  [
    'INSERT',
    {
      parameters: [{ label: 'str' }, { label: 'pos' }, { label: 'len' }, { label: 'newstr' }],
      returnType: 'VARCHAR',
      documentation: 'Returns str with len characters from pos replaced by newstr.',
    },
  ],
  [
    'INSTR',
    {
      parameters: [
        { label: 'str', documentation: 'The string to search in.' },
        { label: 'substr', documentation: 'The substring to find.' },
      ],
      returnType: 'INT',
      documentation: 'Returns the position of the first occurrence of substr in str.',
    },
  ],
  [
    'LCASE',
    {
      parameters: [{ label: 'str', documentation: 'The string to convert.' }],
      returnType: 'VARCHAR',
      documentation: 'Synonym for LOWER().',
    },
  ],
  [
    'LEFT',
    {
      parameters: [
        { label: 'str', documentation: 'The source string.' },
        { label: 'len', documentation: 'Number of characters.' },
      ],
      returnType: 'VARCHAR',
      documentation: 'Returns the leftmost len characters from str.',
    },
  ],
  [
    'LENGTH',
    {
      parameters: [{ label: 'str', documentation: 'The string to measure.' }],
      returnType: 'INT',
      documentation: 'Returns the length of str measured in bytes.',
    },
  ],
  [
    'LOAD_FILE',
    {
      parameters: [{ label: 'file_name' }],
      returnType: 'LONGBLOB',
      documentation: 'Reads the file and returns the file contents as a string.',
    },
  ],
  [
    'LOCATE',
    {
      parameters: [
        { label: 'substr', documentation: 'The substring to search for.' },
        { label: 'str', documentation: 'The string to search within.' },
        {
          label: 'pos (optional)',
          documentation:
            'The position in str at which to start the search. If omitted, defaults to 1.',
        },
      ],
      returnType: 'INT',
      documentation:
        'Returns the position of the first occurrence of substr in str, starting at position pos.',
    },
  ],
  [
    'LOWER',
    {
      parameters: [{ label: 'str', documentation: 'The string to convert.' }],
      returnType: 'VARCHAR',
      documentation: 'Returns str with all characters changed to lowercase.',
    },
  ],
  [
    'LPAD',
    {
      parameters: [
        { label: 'str', documentation: 'The source string.' },
        { label: 'len', documentation: 'Target length.' },
        { label: 'padstr', documentation: 'The padding string.' },
      ],
      returnType: 'VARCHAR',
      documentation: 'Returns str, left-padded with padstr to a length of len characters.',
    },
  ],
  [
    'LTRIM',
    {
      parameters: [{ label: 'str', documentation: 'The string to trim.' }],
      returnType: 'VARCHAR',
      documentation: 'Returns str with leading space characters removed.',
    },
  ],
]
