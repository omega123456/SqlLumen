// MySQL 8.4 / MariaDB 11.x built-in function signature data
// Reference: https://dev.mysql.com/doc/refman/8.4/en/built-in-function-reference.html
//            https://mariadb.com/kb/en/built-in-functions/

export interface BuiltinFunctionSignature {
  label?: string
  parameters: Array<{ label: string; documentation?: string }>
  returnType: string
  documentation: string
}

/**
 * Auto-generate a signature label from the function name and parameter labels.
 * Returns the explicit `label` when provided, otherwise builds `NAME(p1, p2, ...)`.
 */
export function getSignatureLabel(name: string, sig: BuiltinFunctionSignature): string {
  if (sig.label) return sig.label
  const paramStr = sig.parameters.map((p) => p.label).join(', ')
  return `${name}(${paramStr})`
}

export const BUILTIN_FUNCTION_SIGNATURES: Map<string, BuiltinFunctionSignature> = new Map([
  // --- Numeric functions ---
  [
    'ABS',
    {
      parameters: [{ label: 'X', documentation: 'The numeric value to get absolute value of.' }],
      returnType: 'NUMERIC',
      documentation: 'Returns the absolute value of X.',
    },
  ],
  [
    'ACOS',
    {
      parameters: [{ label: 'X', documentation: 'The numeric value.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the arc cosine of X, or NULL if X is not in the range -1 to 1.',
    },
  ],
  [
    'ASIN',
    {
      parameters: [{ label: 'X', documentation: 'The numeric value.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the arc sine of X.',
    },
  ],
  [
    'ATAN',
    {
      parameters: [{ label: 'X', documentation: 'The numeric value.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the arc tangent of X. Also: ATAN(Y, X) for two-argument form.',
    },
  ],
  [
    'ATAN2',
    {
      parameters: [
        { label: 'Y', documentation: 'The y-coordinate.' },
        { label: 'X', documentation: 'The x-coordinate.' },
      ],
      returnType: 'DOUBLE',
      documentation: 'Returns the arc tangent of the two variables Y and X.',
    },
  ],
  [
    'CEIL',
    {
      parameters: [{ label: 'X', documentation: 'The numeric value to round up.' }],
      returnType: 'BIGINT',
      documentation: 'Returns the smallest integer value not less than X.',
    },
  ],
  [
    'CEILING',
    {
      parameters: [{ label: 'X', documentation: 'The numeric value to round up.' }],
      returnType: 'BIGINT',
      documentation: 'Returns the smallest integer value not less than X. Synonym for CEIL().',
    },
  ],
  [
    'CONV',
    {
      parameters: [{ label: 'N' }, { label: 'from_base' }, { label: 'to_base' }],
      returnType: 'VARCHAR',
      documentation: 'Converts numbers between different number bases.',
    },
  ],
  [
    'COS',
    {
      parameters: [{ label: 'X', documentation: 'The angle in radians.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the cosine of X.',
    },
  ],
  [
    'COT',
    {
      parameters: [{ label: 'X' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the cotangent of X.',
    },
  ],
  [
    'CRC32',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'BIGINT',
      documentation:
        'Computes a cyclic redundancy check value and returns a 32-bit unsigned value.',
    },
  ],
  [
    'CRC32C',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'BIGINT',
      documentation:
        'Computes a CRC-32C checksum (Castagnoli) and returns a 32-bit unsigned value.',
    },
  ],
  [
    'DEGREES',
    {
      parameters: [{ label: 'X', documentation: 'The angle in radians.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the argument X, converted from radians to degrees.',
    },
  ],
  [
    'EXP',
    {
      parameters: [{ label: 'X', documentation: 'The exponent.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the value of e raised to the power of X.',
    },
  ],
  [
    'FLOOR',
    {
      parameters: [{ label: 'X', documentation: 'The numeric value to round down.' }],
      returnType: 'BIGINT',
      documentation: 'Returns the largest integer value not greater than X.',
    },
  ],
  [
    'LN',
    {
      parameters: [{ label: 'X', documentation: 'The positive numeric value.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the natural logarithm of X.',
    },
  ],
  [
    'LOG',
    {
      parameters: [{ label: 'X', documentation: 'The positive numeric value.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the natural logarithm of X. Also: LOG(B, X) for base-B logarithm.',
    },
  ],
  [
    'LOG10',
    {
      parameters: [{ label: 'X', documentation: 'The positive numeric value.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the base-10 logarithm of X.',
    },
  ],
  [
    'LOG2',
    {
      parameters: [{ label: 'X', documentation: 'The positive numeric value.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the base-2 logarithm of X.',
    },
  ],
  [
    'MOD',
    {
      parameters: [
        { label: 'N', documentation: 'The dividend.' },
        { label: 'M', documentation: 'The divisor.' },
      ],
      returnType: 'NUMERIC',
      documentation: 'Returns the remainder of N divided by M.',
    },
  ],
  [
    'PI',
    {
      parameters: [],
      returnType: 'DOUBLE',
      documentation: 'Returns the value of pi (3.141593).',
    },
  ],
  [
    'POW',
    {
      parameters: [
        { label: 'X', documentation: 'The base.' },
        { label: 'Y', documentation: 'The exponent.' },
      ],
      returnType: 'DOUBLE',
      documentation: 'Returns the value of X raised to the power of Y.',
    },
  ],
  [
    'POWER',
    {
      parameters: [
        { label: 'X', documentation: 'The base.' },
        { label: 'Y', documentation: 'The exponent.' },
      ],
      returnType: 'DOUBLE',
      documentation: 'Synonym for POW(X, Y).',
    },
  ],
  [
    'RADIANS',
    {
      parameters: [{ label: 'X', documentation: 'The angle in degrees.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the argument X, converted from degrees to radians.',
    },
  ],
  [
    'RAND',
    {
      parameters: [
        {
          label: 'N (optional)',
          documentation: 'Integer seed for reproducible sequence.',
        },
      ],
      returnType: 'DOUBLE',
      documentation:
        'Returns a random floating-point value in the range 0 to 1.0. Also: RAND(N) for seeded random.',
    },
  ],
  [
    'ROUND',
    {
      parameters: [
        { label: 'X', documentation: 'The value to round.' },
        {
          label: 'D (optional)',
          documentation: 'Number of decimal places. Default is 0.',
        },
      ],
      returnType: 'NUMERIC',
      documentation: 'Rounds the argument X to D decimal places.',
    },
  ],
  [
    'SIGN',
    {
      parameters: [{ label: 'X', documentation: 'The numeric value.' }],
      returnType: 'INT',
      documentation: 'Returns the sign of the argument as -1, 0, or 1.',
    },
  ],
  [
    'SIN',
    {
      parameters: [{ label: 'X', documentation: 'The angle in radians.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the sine of X.',
    },
  ],
  [
    'SQRT',
    {
      parameters: [{ label: 'X', documentation: 'The non-negative numeric value.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the square root of a non-negative number X.',
    },
  ],
  [
    'TAN',
    {
      parameters: [{ label: 'X', documentation: 'The angle in radians.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the tangent of X.',
    },
  ],
  [
    'TRUNCATE',
    {
      parameters: [
        { label: 'X', documentation: 'The value to truncate.' },
        { label: 'D', documentation: 'Number of decimal places.' },
      ],
      returnType: 'NUMERIC',
      documentation: 'Returns the number X, truncated to D decimal places.',
    },
  ],

  // --- String functions ---
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

  // --- Date/time functions ---
  [
    'ADD_MONTHS',
    {
      parameters: [{ label: 'date' }, { label: 'months' }],
      returnType: 'DATE',
      documentation: 'Adds the specified number of months to a date (MariaDB/Oracle mode).',
    },
  ],
  [
    'ADDDATE',
    {
      parameters: [
        { label: 'date', documentation: 'The starting date.' },
        { label: 'INTERVAL expr unit', documentation: 'The interval to add.' },
      ],
      returnType: 'DATE',
      documentation: 'Adds a time value to a date. Also: ADDDATE(date, days)',
    },
  ],
  [
    'ADDTIME',
    {
      parameters: [{ label: 'expr1' }, { label: 'expr2' }],
      returnType: 'mixed',
      documentation: 'Adds expr2 to expr1 and returns the result.',
    },
  ],
  [
    'CURDATE',
    {
      parameters: [],
      returnType: 'DATE',
      documentation: 'Returns the current date as YYYY-MM-DD.',
    },
  ],
  [
    'CURRENT_DATE',
    {
      parameters: [],
      returnType: 'DATE',
      documentation: 'Synonym for CURDATE().',
    },
  ],
  [
    'CURRENT_TIME',
    {
      parameters: [
        {
          label: 'fsp (optional)',
          documentation: 'Fractional seconds precision.',
        },
      ],
      returnType: 'TIME',
      documentation: 'Synonym for CURTIME().',
    },
  ],
  [
    'CURRENT_TIMESTAMP',
    {
      parameters: [
        {
          label: 'fsp (optional)',
          documentation: 'Fractional seconds precision (0-6).',
        },
      ],
      returnType: 'DATETIME',
      documentation: 'Synonym for NOW().',
    },
  ],
  [
    'CURTIME',
    {
      parameters: [
        {
          label: 'fsp (optional)',
          documentation: 'Fractional seconds precision.',
        },
      ],
      returnType: 'TIME',
      documentation: 'Returns the current time as hh:mm:ss.',
    },
  ],
  [
    'DATE',
    {
      parameters: [{ label: 'expr', documentation: 'A datetime or date expression.' }],
      returnType: 'DATE',
      documentation: 'Extracts the date part of the date or datetime expression expr.',
    },
  ],
  [
    'DATE_ADD',
    {
      parameters: [
        { label: 'date', documentation: 'The starting date.' },
        { label: 'INTERVAL expr unit', documentation: 'The interval to add.' },
      ],
      returnType: 'DATE',
      documentation: 'Adds a time/date interval to a date.',
    },
  ],
  [
    'DATE_FORMAT',
    {
      parameters: [
        { label: 'date', documentation: 'The date or datetime value to format.' },
        {
          label: 'format',
          documentation:
            'The format string using specifiers such as %Y (year), %m (month), %d (day), %H (hour), %i (minute), %s (second).',
        },
      ],
      returnType: 'VARCHAR',
      documentation: 'Formats the date value according to the format string.',
    },
  ],
  [
    'DATE_SUB',
    {
      parameters: [
        { label: 'date', documentation: 'The starting date.' },
        { label: 'INTERVAL expr unit', documentation: 'The interval to add.' },
      ],
      returnType: 'DATE',
      documentation: 'Subtracts a time/date interval from a date.',
    },
  ],
  [
    'DATEDIFF',
    {
      parameters: [
        { label: 'expr1', documentation: 'The later date.' },
        { label: 'expr2', documentation: 'The earlier date.' },
      ],
      returnType: 'INT',
      documentation: 'Returns the number of days between the two date arguments.',
    },
  ],
  [
    'DAY',
    {
      parameters: [{ label: 'date', documentation: 'A date or datetime value.' }],
      returnType: 'INT',
      documentation: 'Returns the day of the month for date. Synonym for DAYOFMONTH().',
    },
  ],
  [
    'DAYNAME',
    {
      parameters: [{ label: 'date', documentation: 'A date or datetime value.' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the name of the weekday for date.',
    },
  ],
  [
    'DAYOFMONTH',
    {
      parameters: [{ label: 'date', documentation: 'A date or datetime value.' }],
      returnType: 'INT',
      documentation: 'Returns the day of the month for date, in the range 1 to 31.',
    },
  ],
  [
    'DAYOFWEEK',
    {
      parameters: [{ label: 'date', documentation: 'A date or datetime value.' }],
      returnType: 'INT',
      documentation: 'Returns the weekday index for date (1=Sunday, 7=Saturday).',
    },
  ],
  [
    'DAYOFYEAR',
    {
      parameters: [{ label: 'date', documentation: 'A date or datetime value.' }],
      returnType: 'INT',
      documentation: 'Returns the day of the year for date, in the range 1 to 366.',
    },
  ],
  [
    'EXTRACT',
    {
      parameters: [{ label: 'unit FROM date' }],
      returnType: 'INT',
      documentation: 'Extracts part of a date. unit: YEAR, MONTH, DAY, HOUR, MINUTE, SECOND, etc.',
    },
  ],
  [
    'FROM_DAYS',
    {
      parameters: [{ label: 'N' }],
      returnType: 'DATE',
      documentation: 'Given a day number N, returns a DATE value.',
    },
  ],
  [
    'FROM_UNIXTIME',
    {
      parameters: [
        {
          label: 'unix_timestamp',
          documentation: 'Unix timestamp (seconds since epoch).',
        },
        {
          label: 'format (optional)',
          documentation: 'Date format string.',
        },
      ],
      returnType: 'DATETIME',
      documentation: 'Returns a representation of the Unix timestamp as a date and time.',
    },
  ],
  [
    'GET_FORMAT',
    {
      parameters: [{ label: 'date_type' }, { label: 'format_type' }],
      returnType: 'VARCHAR',
      documentation: 'Returns a format string for date formatting.',
    },
  ],
  [
    'HOUR',
    {
      parameters: [{ label: 'time', documentation: 'A date or datetime value.' }],
      returnType: 'INT',
      documentation: 'Returns the hour for time, in the range 0 to 838.',
    },
  ],
  [
    'LAST_DAY',
    {
      parameters: [{ label: 'date' }],
      returnType: 'DATE',
      documentation: 'Returns the last day of the month for the given date.',
    },
  ],
  [
    'LOCALTIME',
    {
      parameters: [],
      returnType: 'DATETIME',
      documentation: 'Synonym for NOW().',
    },
  ],
  [
    'LOCALTIMESTAMP',
    {
      parameters: [],
      returnType: 'DATETIME',
      documentation: 'Synonym for NOW().',
    },
  ],
  [
    'MAKEDATE',
    {
      parameters: [{ label: 'year' }, { label: 'dayofyear' }],
      returnType: 'DATE',
      documentation: 'Returns a date, given year and day-of-year values.',
    },
  ],
  [
    'MAKETIME',
    {
      parameters: [{ label: 'hour' }, { label: 'minute' }, { label: 'second' }],
      returnType: 'TIME',
      documentation: 'Returns a time value calculated from the hour, minute, and second arguments.',
    },
  ],
  [
    'MICROSECOND',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'INT',
      documentation: 'Returns the microseconds from the time or datetime expression expr.',
    },
  ],
  [
    'MINUTE',
    {
      parameters: [{ label: 'time', documentation: 'A date or datetime value.' }],
      returnType: 'INT',
      documentation: 'Returns the minute for time, in the range 0 to 59.',
    },
  ],
  [
    'MONTH',
    {
      parameters: [{ label: 'date', documentation: 'A date or datetime value.' }],
      returnType: 'INT',
      documentation: 'Returns the month for date, in the range 1 to 12.',
    },
  ],
  [
    'MONTHNAME',
    {
      parameters: [{ label: 'date', documentation: 'A date or datetime value.' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the full name of the month for date.',
    },
  ],
  [
    'NOW',
    {
      parameters: [
        {
          label: 'fsp (optional)',
          documentation: 'Fractional seconds precision (0-6).',
        },
      ],
      returnType: 'DATETIME',
      documentation: 'Returns the current date and time.',
    },
  ],
  [
    'PERIOD_ADD',
    {
      parameters: [{ label: 'P' }, { label: 'N' }],
      returnType: 'INT',
      documentation: 'Adds N months to period P (in YYMM or YYYYMM format).',
    },
  ],
  [
    'PERIOD_DIFF',
    {
      parameters: [{ label: 'P1' }, { label: 'P2' }],
      returnType: 'INT',
      documentation: 'Returns the number of months between periods P1 and P2.',
    },
  ],
  [
    'QUARTER',
    {
      parameters: [{ label: 'date' }],
      returnType: 'INT',
      documentation: 'Returns the quarter of the year for date, in the range 1 to 4.',
    },
  ],
  [
    'SEC_TO_TIME',
    {
      parameters: [{ label: 'seconds' }],
      returnType: 'TIME',
      documentation:
        'Returns the seconds argument converted to hours, minutes, and seconds as a TIME value.',
    },
  ],
  [
    'SECOND',
    {
      parameters: [{ label: 'time', documentation: 'A date or datetime value.' }],
      returnType: 'INT',
      documentation: 'Returns the second for time, in the range 0 to 59.',
    },
  ],
  [
    'STR_TO_DATE',
    {
      parameters: [
        { label: 'str', documentation: 'The string to parse.' },
        { label: 'format', documentation: 'The format string.' },
      ],
      returnType: 'DATE',
      documentation: 'Converts a string to a date value using the format string.',
    },
  ],
  [
    'SUBDATE',
    {
      parameters: [{ label: 'date' }, { label: 'INTERVAL expr unit' }],
      returnType: 'DATE',
      documentation: 'Subtracts a time interval from a date. Also: SUBDATE(date, days)',
    },
  ],
  [
    'SUBTIME',
    {
      parameters: [{ label: 'expr1' }, { label: 'expr2' }],
      returnType: 'mixed',
      documentation: 'Returns expr1 minus expr2 expressed as the same type as expr1.',
    },
  ],
  [
    'SYSDATE',
    {
      parameters: [
        {
          label: 'fsp (optional)',
          documentation: 'Fractional seconds precision (0-6).',
        },
      ],
      returnType: 'DATETIME',
      documentation: 'Returns the current date and time at function execution time.',
    },
  ],
  [
    'TIME',
    {
      parameters: [{ label: 'expr', documentation: 'A datetime or time expression.' }],
      returnType: 'TIME',
      documentation: 'Extracts the time part of the time or datetime expression expr.',
    },
  ],
  [
    'TIME_FORMAT',
    {
      parameters: [{ label: 'time' }, { label: 'format' }],
      returnType: 'VARCHAR',
      documentation: 'Formats the time value according to the format string.',
    },
  ],
  [
    'TIME_TO_SEC',
    {
      parameters: [{ label: 'time' }],
      returnType: 'INT',
      documentation: 'Returns the time argument converted to seconds.',
    },
  ],
  [
    'TIMEDIFF',
    {
      parameters: [
        { label: 'expr1', documentation: 'The later time.' },
        { label: 'expr2', documentation: 'The earlier time.' },
      ],
      returnType: 'TIME',
      documentation: 'Returns expr1 minus expr2 expressed as a time value.',
    },
  ],
  [
    'TIMESTAMP',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DATETIME',
      documentation:
        'Returns a datetime expression. Also: TIMESTAMP(expr1, expr2) adds time expr2 to expr1.',
    },
  ],
  [
    'TIMESTAMPADD',
    {
      parameters: [{ label: 'unit' }, { label: 'interval' }, { label: 'datetime_expr' }],
      returnType: 'DATETIME',
      documentation: 'Adds the integer interval to datetime_expr.',
    },
  ],
  [
    'TIMESTAMPDIFF',
    {
      parameters: [
        {
          label: 'unit',
          documentation:
            'The interval unit (SECOND, MINUTE, HOUR, DAY, WEEK, MONTH, QUARTER, YEAR).',
        },
        { label: 'datetime_expr1', documentation: 'The start datetime.' },
        { label: 'datetime_expr2', documentation: 'The end datetime.' },
      ],
      returnType: 'INT',
      documentation:
        'Returns datetime_expr2 minus datetime_expr1, where unit specifies the result unit.',
    },
  ],
  [
    'TO_CHAR',
    {
      parameters: [{ label: 'expr' }, { label: 'fmt' }],
      returnType: 'VARCHAR',
      documentation:
        'Converts a date/number to a string using the given format (MariaDB/Oracle mode).',
    },
  ],
  [
    'TO_DAYS',
    {
      parameters: [{ label: 'date' }],
      returnType: 'INT',
      documentation: 'Returns the number of days since year 0 for the given date.',
    },
  ],
  [
    'TO_SECONDS',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'INT',
      documentation:
        'Returns the number of seconds elapsed since year 0 for the given date or datetime.',
    },
  ],
  [
    'TRUNC',
    {
      parameters: [{ label: 'date' }],
      returnType: 'DATE',
      documentation: 'Truncates a date to the specified unit (MariaDB/Oracle mode).',
    },
  ],
  [
    'UNIX_TIMESTAMP',
    {
      parameters: [
        {
          label: 'date (optional)',
          documentation: 'A date/datetime value. If omitted, returns current timestamp.',
        },
      ],
      returnType: 'BIGINT',
      documentation: 'Returns a Unix timestamp. Also: UNIX_TIMESTAMP(date) to convert a date.',
    },
  ],
  [
    'UTC_DATE',
    {
      parameters: [],
      returnType: 'DATE',
      documentation: 'Returns the current UTC date as YYYY-MM-DD.',
    },
  ],
  [
    'UTC_TIME',
    {
      parameters: [],
      returnType: 'TIME',
      documentation: 'Returns the current UTC time as hh:mm:ss.',
    },
  ],
  [
    'UTC_TIMESTAMP',
    {
      parameters: [],
      returnType: 'DATETIME',
      documentation: 'Returns the current UTC date and time.',
    },
  ],
  [
    'WEEK',
    {
      parameters: [
        { label: 'date', documentation: 'The date value to extract the week number from.' },
        {
          label: 'mode (optional)',
          documentation:
            'Specifies the day the week starts on and the return value range. Values 0–7. If omitted, uses the default_week_format system variable.',
        },
      ],
      returnType: 'INT',
      documentation: 'Returns the week number for the given date.',
    },
  ],
  [
    'WEEKDAY',
    {
      parameters: [{ label: 'date' }],
      returnType: 'INT',
      documentation: 'Returns the weekday index for date (0=Monday, 6=Sunday).',
    },
  ],
  [
    'WEEKOFYEAR',
    {
      parameters: [{ label: 'date' }],
      returnType: 'INT',
      documentation: 'Returns the calendar week of the date as a number in the range 1 to 53.',
    },
  ],
  [
    'YEAR',
    {
      parameters: [{ label: 'date', documentation: 'A date or datetime value.' }],
      returnType: 'INT',
      documentation: 'Returns the year for date, in the range 1000 to 9999.',
    },
  ],
  [
    'YEARWEEK',
    {
      parameters: [
        { label: 'date', documentation: 'The date value to extract year and week from.' },
        {
          label: 'mode (optional)',
          documentation:
            'Specifies the day the week starts on and the return value range. Values 0–7. If omitted, defaults to 0.',
        },
      ],
      returnType: 'INT',
      documentation:
        'Returns the year and week number for the given date as a combined integer (YYYYWW).',
    },
  ],

  // --- Aggregate functions ---
  [
    'AVG',
    {
      parameters: [{ label: 'expr', documentation: 'The numeric expression to average.' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the average value of expr.',
    },
  ],
  [
    'BIT_AND',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'BIGINT',
      documentation: 'Returns the bitwise AND of all bits in expr.',
    },
  ],
  [
    'BIT_OR',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'BIGINT',
      documentation: 'Returns the bitwise OR of all bits in expr.',
    },
  ],
  [
    'BIT_XOR',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'BIGINT',
      documentation: 'Returns the bitwise XOR of all bits in expr.',
    },
  ],
  [
    'COUNT',
    {
      parameters: [
        {
          label: 'expr',
          documentation: 'The expression to count. Use * to count all rows.',
        },
      ],
      returnType: 'BIGINT',
      documentation:
        'Returns a count of the number of non-NULL values. Also: COUNT(*), COUNT(DISTINCT expr)',
    },
  ],
  [
    'GROUP_CONCAT',
    {
      parameters: [
        {
          label: 'expr',
          documentation: 'The expression to concatenate. Supports ORDER BY and SEPARATOR.',
        },
      ],
      returnType: 'TEXT',
      documentation: 'Returns a string result with the concatenated non-NULL values from a group.',
    },
  ],
  [
    'JSON_ARRAYAGG',
    {
      parameters: [
        { label: 'col_or_expr', documentation: 'The value to aggregate into a JSON array.' },
      ],
      returnType: 'JSON',
      documentation: 'Aggregates a result set as a single JSON array.',
    },
  ],
  [
    'JSON_OBJECTAGG',
    {
      parameters: [
        { label: 'key', documentation: 'The key expression.' },
        { label: 'value', documentation: 'The value expression.' },
      ],
      returnType: 'JSON',
      documentation: 'Aggregates a result set as a single JSON object.',
    },
  ],
  [
    'MAX',
    {
      parameters: [{ label: 'expr', documentation: 'The expression to find minimum/maximum of.' }],
      returnType: 'mixed',
      documentation: 'Returns the maximum value of expr.',
    },
  ],
  [
    'MEDIAN',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the median value of expr within a group (MariaDB).',
    },
  ],
  [
    'MIN',
    {
      parameters: [{ label: 'expr', documentation: 'The expression to find minimum/maximum of.' }],
      returnType: 'mixed',
      documentation: 'Returns the minimum value of expr.',
    },
  ],
  [
    'STD',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the population standard deviation of expr.',
    },
  ],
  [
    'STDDEV',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the population standard deviation of expr. Synonym for STD().',
    },
  ],
  [
    'STDDEV_POP',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the population standard deviation of expr.',
    },
  ],
  [
    'STDDEV_SAMP',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the sample standard deviation of expr.',
    },
  ],
  [
    'SUM',
    {
      parameters: [{ label: 'expr', documentation: 'The numeric expression to sum.' }],
      returnType: 'NUMERIC',
      documentation: 'Returns the sum of expr.',
    },
  ],
  [
    'VAR_POP',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the population standard variance of expr.',
    },
  ],
  [
    'VAR_SAMP',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the sample variance of expr.',
    },
  ],
  [
    'VARIANCE',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the population standard variance of expr.',
    },
  ],

  // --- Window functions ---
  [
    'CUME_DIST',
    {
      parameters: [],
      returnType: 'DOUBLE',
      documentation:
        'Returns the cumulative distribution of a value within a group of values (window function).',
    },
  ],
  [
    'DENSE_RANK',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation: 'Returns the rank of the current row without gaps (window function).',
    },
  ],
  [
    'FIRST_VALUE',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'mixed',
      documentation:
        'Returns the value of expr from the first row of the window frame (window function).',
    },
  ],
  [
    'LAG',
    {
      parameters: [{ label: 'expr' }, { label: 'N' }, { label: 'default' }],
      returnType: 'mixed',
      documentation:
        'Returns the value of expr from N rows before the current row (window function).',
    },
  ],
  [
    'LAST_VALUE',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'mixed',
      documentation:
        'Returns the value of expr from the last row of the window frame (window function).',
    },
  ],
  [
    'LEAD',
    {
      parameters: [{ label: 'expr' }, { label: 'N' }, { label: 'default' }],
      returnType: 'mixed',
      documentation:
        'Returns the value of expr from N rows after the current row (window function).',
    },
  ],
  [
    'NTH_VALUE',
    {
      parameters: [{ label: 'expr' }, { label: 'N' }],
      returnType: 'mixed',
      documentation:
        'Returns the value of expr from the Nth row of the window frame (window function).',
    },
  ],
  [
    'NTILE',
    {
      parameters: [{ label: 'N' }],
      returnType: 'BIGINT',
      documentation:
        'Divides the partition into N groups and returns the group number of the current row (window function).',
    },
  ],
  [
    'PERCENT_RANK',
    {
      parameters: [],
      returnType: 'DOUBLE',
      documentation: 'Returns the percentage rank of the current row (window function).',
    },
  ],
  [
    'PERCENTILE_CONT',
    {
      parameters: [{ label: 'percentile' }],
      returnType: 'DOUBLE',
      documentation: 'Continuous percentile within a group (window function).',
    },
  ],
  [
    'PERCENTILE_DISC',
    {
      parameters: [{ label: 'percentile' }],
      returnType: 'mixed',
      documentation: 'Discrete percentile within a group (window function).',
    },
  ],
  [
    'RANK',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation: 'Returns the rank of the current row with gaps (window function).',
    },
  ],
  [
    'ROW_NUMBER',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation:
        'Returns the number of the current row within its partition, starting at 1 (window function).',
    },
  ],

  // --- Control flow ---
  [
    'COALESCE',
    {
      parameters: [
        { label: 'value', documentation: 'An expression. The first non-NULL value is returned.' },
        { label: '...' },
      ],
      returnType: 'mixed',
      documentation: 'Returns the first non-NULL value in the list.',
    },
  ],
  [
    'IF',
    {
      parameters: [
        { label: 'expr1', documentation: 'The boolean expression.' },
        { label: 'expr2', documentation: 'Value returned when condition is true.' },
        { label: 'expr3', documentation: 'Value returned when condition is false.' },
      ],
      returnType: 'mixed',
      documentation: 'If expr1 is TRUE, returns expr2; otherwise returns expr3.',
    },
  ],
  [
    'IFNULL',
    {
      parameters: [
        { label: 'expr1', documentation: 'The expression to test for NULL.' },
        { label: 'expr2', documentation: 'The value returned if expr is NULL.' },
      ],
      returnType: 'mixed',
      documentation: 'If expr1 is not NULL, returns expr1; otherwise returns expr2.',
    },
  ],
  [
    'NULLIF',
    {
      parameters: [
        { label: 'expr1', documentation: 'The first expression.' },
        { label: 'expr2', documentation: 'If equal to expr1, NULL is returned.' },
      ],
      returnType: 'mixed',
      documentation: 'Returns NULL if expr1 = expr2, otherwise returns expr1.',
    },
  ],
  [
    'INTERVAL',
    {
      parameters: [{ label: 'N' }, { label: 'N1' }, { label: 'N2' }, { label: '...' }],
      returnType: 'INT',
      documentation: 'Returns 0 if N < N1, 1 if N < N2, etc. Returns -1 if N is NULL.',
    },
  ],

  // --- Comparison / utility functions ---
  [
    'GREATEST',
    {
      parameters: [
        { label: 'value1', documentation: 'A comparable value.' },
        { label: 'value2', documentation: 'A comparable value.' },
        { label: '...' },
      ],
      returnType: 'mixed',
      documentation: 'Returns the largest (maximum-valued) argument.',
    },
  ],
  [
    'ISNULL',
    {
      parameters: [{ label: 'expr', documentation: 'The expression to test.' }],
      returnType: 'INT',
      documentation: 'Returns 1 if expr is NULL, 0 otherwise.',
    },
  ],
  [
    'LEAST',
    {
      parameters: [
        { label: 'value1', documentation: 'A comparable value.' },
        { label: 'value2', documentation: 'A comparable value.' },
        { label: '...' },
      ],
      returnType: 'mixed',
      documentation: 'Returns the smallest (minimum-valued) argument.',
    },
  ],

  // --- Information functions ---
  [
    'BENCHMARK',
    {
      parameters: [{ label: 'loop_count' }, { label: 'expr' }],
      returnType: 'INT',
      documentation: 'Executes the expression expr repeatedly loop_count times.',
    },
  ],
  [
    'COERCIBILITY',
    {
      parameters: [{ label: 'str' }],
      returnType: 'INT',
      documentation: 'Returns the collation coercibility value of the string argument.',
    },
  ],
  [
    'COLLATION',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the collation of the string argument.',
    },
  ],
  [
    'CONNECTION_ID',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation: 'Returns the connection ID (thread ID) for the connection.',
    },
  ],
  [
    'CURRENT_ROLE',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns the current active roles for the session.',
    },
  ],
  [
    'CURRENT_USER',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns the MySQL account for the current session.',
    },
  ],
  [
    'DATABASE',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns the name of the default (current) database.',
    },
  ],
  [
    'DECODE_HISTOGRAM',
    {
      parameters: [{ label: 'hist_type' }, { label: 'histogram' }],
      returnType: 'VARCHAR',
      documentation: 'Decodes a histogram from the statistics tables (MariaDB).',
    },
  ],
  [
    'DEFAULT',
    {
      parameters: [{ label: 'col_name' }],
      returnType: 'mixed',
      documentation: 'Returns the default value for a table column.',
    },
  ],
  [
    'FOUND_ROWS',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation: 'Returns the number of rows that would have been returned without LIMIT.',
    },
  ],
  [
    'LAST_INSERT_ID',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation:
        'Returns the AUTO_INCREMENT value generated by the most recent INSERT or UPDATE.',
    },
  ],
  [
    'ROW_COUNT',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation:
        'Returns the number of rows changed, deleted, or inserted by the preceding statement.',
    },
  ],
  [
    'SCHEMA',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Synonym for DATABASE().',
    },
  ],
  [
    'SESSION_USER',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Synonym for USER().',
    },
  ],
  [
    'SYSTEM_USER',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Synonym for USER().',
    },
  ],
  [
    'USER',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns the current MySQL user name and host name.',
    },
  ],
  [
    'VERSION',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns the MySQL server version as a string.',
    },
  ],

  // --- Encryption / hashing / compression ---
  [
    'AES_DECRYPT',
    {
      parameters: [{ label: 'crypt_str' }, { label: 'key_str' }],
      returnType: 'VARBINARY',
      documentation: 'Decrypts data using the AES algorithm.',
    },
  ],
  [
    'AES_ENCRYPT',
    {
      parameters: [{ label: 'str' }, { label: 'key_str' }],
      returnType: 'VARBINARY',
      documentation: 'Encrypts data using the AES algorithm.',
    },
  ],
  [
    'COMPRESS',
    {
      parameters: [{ label: 'string_to_compress' }],
      returnType: 'VARBINARY',
      documentation: 'Compresses a string and returns the result as a binary string.',
    },
  ],
  [
    'DES_DECRYPT',
    {
      parameters: [{ label: 'crypt_str' }],
      returnType: 'VARCHAR',
      documentation: 'Decrypts a string encrypted with DES_ENCRYPT().',
    },
  ],
  [
    'DES_ENCRYPT',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARBINARY',
      documentation: 'Encrypts the string with the Triple-DES algorithm.',
    },
  ],
  [
    'DECODE',
    {
      parameters: [{ label: 'crypt_str' }, { label: 'pass_str' }],
      returnType: 'VARCHAR',
      documentation: 'Decrypts the encrypted string using pass_str as the password.',
    },
  ],
  [
    'ENCODE',
    {
      parameters: [{ label: 'str' }, { label: 'pass_str' }],
      returnType: 'VARBINARY',
      documentation: 'Encrypts str using pass_str as the password.',
    },
  ],
  [
    'ENCRYPT',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARCHAR',
      documentation: 'Encrypts str using the Unix crypt() system call.',
    },
  ],
  [
    'KDF',
    {
      parameters: [{ label: 'key_str' }, { label: 'salt' }, { label: 'info' }],
      returnType: 'VARBINARY',
      documentation: 'Key derivation function (MariaDB 11.x+).',
    },
  ],
  [
    'MD5',
    {
      parameters: [{ label: 'str', documentation: 'The string to hash.' }],
      returnType: 'VARCHAR',
      documentation: 'Computes an MD5 128-bit checksum for the string.',
    },
  ],
  [
    'OLD_PASSWORD',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the pre-4.1 password hash. Deprecated.',
    },
  ],
  [
    'PASSWORD',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARCHAR',
      documentation: 'Computes a MySQL password hash from str.',
    },
  ],
  [
    'SHA',
    {
      parameters: [{ label: 'str', documentation: 'The string to hash.' }],
      returnType: 'VARCHAR',
      documentation: 'Calculates an SHA-1 160-bit checksum for the string.',
    },
  ],
  [
    'SHA1',
    {
      parameters: [{ label: 'str', documentation: 'The string to hash.' }],
      returnType: 'VARCHAR',
      documentation: 'Calculates an SHA-1 160-bit checksum for the string.',
    },
  ],
  [
    'SHA2',
    {
      parameters: [
        { label: 'str', documentation: 'The string to hash.' },
        {
          label: 'hash_length',
          documentation: 'Hash bit length (224, 256, 384, or 512).',
        },
      ],
      returnType: 'VARCHAR',
      documentation:
        'Computes the SHA-2 family of hash functions. hash_length: 224, 256, 384, or 512.',
    },
  ],

  // --- JSON functions ---
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

  // --- MariaDB Dynamic column functions ---
  [
    'COLUMN_ADD',
    {
      parameters: [
        { label: 'dyncol_blob' },
        { label: 'column_nr' },
        { label: 'value' },
        { label: '...' },
      ],
      returnType: 'VARBINARY',
      documentation: 'Adds or updates dynamic columns in a dynamic columns blob (MariaDB).',
    },
  ],
  [
    'COLUMN_CHECK',
    {
      parameters: [{ label: 'dyncol_blob' }],
      returnType: 'INT',
      documentation: 'Checks whether a dynamic columns blob is valid (MariaDB).',
    },
  ],
  [
    'COLUMN_CREATE',
    {
      parameters: [{ label: 'column_nr' }, { label: 'value' }, { label: '...' }],
      returnType: 'VARBINARY',
      documentation: 'Creates a dynamic columns blob (MariaDB).',
    },
  ],
  [
    'COLUMN_DELETE',
    {
      parameters: [{ label: 'dyncol_blob' }, { label: 'column_nr' }, { label: '...' }],
      returnType: 'VARBINARY',
      documentation: 'Deletes dynamic columns from a dynamic columns blob (MariaDB).',
    },
  ],
  [
    'COLUMN_EXISTS',
    {
      parameters: [{ label: 'dyncol_blob' }, { label: 'column_nr' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the given column exists in the dynamic columns blob (MariaDB).',
    },
  ],
  [
    'COLUMN_GET',
    {
      parameters: [{ label: 'dyncol_blob' }, { label: 'column_nr AS type' }],
      returnType: 'mixed',
      documentation: 'Gets the value of a dynamic column from a blob (MariaDB).',
    },
  ],
  [
    'COLUMN_JSON',
    {
      parameters: [{ label: 'dyncol_blob' }],
      returnType: 'JSON',
      documentation: 'Returns a JSON representation of a dynamic columns blob (MariaDB).',
    },
  ],
  [
    'COLUMN_LIST',
    {
      parameters: [{ label: 'dyncol_blob' }],
      returnType: 'VARCHAR',
      documentation:
        'Returns a comma-separated list of column names from a dynamic columns blob (MariaDB).',
    },
  ],

  // --- Network / IPv6 functions ---
  [
    'INET_ATON',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'BIGINT',
      documentation:
        'Given the dotted-quad representation of a network address, returns an integer.',
    },
  ],
  [
    'INET_NTOA',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'VARCHAR',
      documentation: 'Given a numeric IPv4 network address, returns the dotted-quad string.',
    },
  ],
  [
    'INET6_ATON',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'VARBINARY',
      documentation: 'Given an IPv6 or IPv4 address string, returns the binary representation.',
    },
  ],
  [
    'INET6_NTOA',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'VARCHAR',
      documentation: 'Given a binary IPv6 address, returns the string representation.',
    },
  ],
  [
    'IS_IPV4',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the argument is a valid IPv4 address, 0 otherwise.',
    },
  ],
  [
    'IS_IPV4_COMPAT',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the argument is an IPv4-compatible IPv6 address.',
    },
  ],
  [
    'IS_IPV4_MAPPED',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the argument is an IPv4-mapped IPv6 address.',
    },
  ],
  [
    'IS_IPV6',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the argument is a valid IPv6 address, 0 otherwise.',
    },
  ],

  // --- Lock functions ---
  [
    'GET_LOCK',
    {
      parameters: [{ label: 'str' }, { label: 'timeout' }],
      returnType: 'INT',
      documentation: 'Tries to obtain a lock with name str, using a timeout of timeout seconds.',
    },
  ],
  [
    'IS_FREE_LOCK',
    {
      parameters: [{ label: 'str' }],
      returnType: 'INT',
      documentation: 'Checks whether the lock named str is free to use.',
    },
  ],
  [
    'IS_USED_LOCK',
    {
      parameters: [{ label: 'str' }],
      returnType: 'BIGINT',
      documentation:
        'Returns the connection ID of the client that holds the lock named str, or NULL.',
    },
  ],
  [
    'RELEASE_LOCK',
    {
      parameters: [{ label: 'str' }],
      returnType: 'INT',
      documentation: 'Releases the lock named str that was obtained with GET_LOCK().',
    },
  ],

  // --- MariaDB Sequence functions ---
  [
    'LASTVAL',
    {
      parameters: [{ label: 'sequence_name' }],
      returnType: 'BIGINT',
      documentation:
        'Returns the last value generated by NEXTVAL for the given sequence in the current session (MariaDB).',
    },
  ],
  [
    'NEXTVAL',
    {
      parameters: [{ label: 'sequence_name' }],
      returnType: 'BIGINT',
      documentation: 'Increments the sequence and returns the next value (MariaDB).',
    },
  ],
  [
    'SETVAL',
    {
      parameters: [{ label: 'sequence_name' }, { label: 'value' }],
      returnType: 'BIGINT',
      documentation: 'Sets the next value for the sequence (MariaDB).',
    },
  ],

  // --- UUID functions ---
  [
    'SYS_GUID',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns a globally unique identifier (MariaDB/Oracle mode).',
    },
  ],
  [
    'UUID',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation:
        'Returns a Universal Unique Identifier (UUID) generated according to RFC 4122.',
    },
  ],
  [
    'UUID_SHORT',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation: 'Returns a short universal identifier as a 64-bit unsigned integer.',
    },
  ],
  [
    'UUIDV4',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns a version 4 (random) UUID (MariaDB 11.7+).',
    },
  ],
  [
    'UUIDV7',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns a version 7 (timestamp-based) UUID (MariaDB 11.7+).',
    },
  ],

  // --- Replication / GTID functions ---
  [
    'BINLOG_GTID_POS',
    {
      parameters: [{ label: 'binlog_filename' }, { label: 'binlog_offset' }],
      returnType: 'VARCHAR',
      documentation:
        'Returns the GTID position corresponding to the given binary log file and offset (MariaDB).',
    },
  ],
  [
    'MASTER_GTID_WAIT',
    {
      parameters: [{ label: 'gtid_list' }],
      returnType: 'INT',
      documentation: 'Waits until the server has applied all GTIDs in the given list (MariaDB).',
    },
  ],
  [
    'MASTER_POS_WAIT',
    {
      parameters: [{ label: 'log_name' }, { label: 'log_pos' }],
      returnType: 'INT',
      documentation:
        'Blocks until the replica has applied all updates to the specified binary log position.',
    },
  ],

  // --- WSREP / Galera functions ---
  [
    'WSREP_LAST_SEEN_GTID',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns the last GTID seen in the write-set replication stream (Galera).',
    },
  ],
  [
    'WSREP_LAST_WRITTEN_GTID',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns the last GTID written in the write-set replication stream (Galera).',
    },
  ],
  [
    'WSREP_SYNC_WAIT_UPTO_GTID',
    {
      parameters: [{ label: 'gtid' }],
      returnType: 'INT',
      documentation:
        'Waits until the node has applied all transactions up to the given GTID (Galera).',
    },
  ],

  // --- Spider engine functions ---
  [
    'SPIDER_BG_DIRECT_SQL',
    {
      parameters: [{ label: 'sql' }, { label: 'conn_id' }, { label: 'link_id' }],
      returnType: 'INT',
      documentation: 'Executes SQL on a remote Spider node in the background.',
    },
  ],
  [
    'SPIDER_COPY_TABLES',
    {
      parameters: [{ label: 'table_name' }, { label: 'src' }, { label: 'dst' }],
      returnType: 'INT',
      documentation: 'Copies Spider table data from one node to another.',
    },
  ],
  [
    'SPIDER_DIRECT_SQL',
    {
      parameters: [{ label: 'sql' }, { label: 'conn_id' }, { label: 'link_id' }],
      returnType: 'INT',
      documentation: 'Executes SQL directly on a remote Spider node.',
    },
  ],
  [
    'SPIDER_FLUSH_TABLE_MON_CACHE',
    {
      parameters: [],
      returnType: 'INT',
      documentation: 'Flushes the Spider table monitoring cache.',
    },
  ],

  // --- Vector functions (MariaDB 11.6+) ---
  [
    'VEC_DISTANCE',
    {
      parameters: [{ label: 'vec1' }, { label: 'vec2' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the distance between two vectors (MariaDB 11.6+).',
    },
  ],
  [
    'VEC_DISTANCE_COSINE',
    {
      parameters: [{ label: 'vec1' }, { label: 'vec2' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the cosine distance between two vectors (MariaDB 11.6+).',
    },
  ],
  [
    'VEC_DISTANCE_EUCLIDEAN',
    {
      parameters: [{ label: 'vec1' }, { label: 'vec2' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the Euclidean distance between two vectors (MariaDB 11.6+).',
    },
  ],
  [
    'VEC_FROMTEXT',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARBINARY',
      documentation: 'Converts a text representation of a vector to binary format (MariaDB 11.6+).',
    },
  ],
  [
    'VEC_TOTEXT',
    {
      parameters: [{ label: 'vec' }],
      returnType: 'VARCHAR',
      documentation: 'Converts a binary vector to its text representation (MariaDB 11.6+).',
    },
  ],

  // --- XML functions ---
  [
    'EXTRACTVALUE',
    {
      parameters: [{ label: 'xml_frag' }, { label: 'xpath_expr' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the text of the first text node matching the XPath expression.',
    },
  ],
  [
    'UPDATEXML',
    {
      parameters: [{ label: 'xml_target' }, { label: 'xpath_expr' }, { label: 'new_xml' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the changed XML fragment, or the original if XPath does not match.',
    },
  ],

  // --- Misc utility ---
  [
    'BIT_COUNT',
    {
      parameters: [{ label: 'N' }],
      returnType: 'BIGINT',
      documentation: 'Returns the number of bits that are set in the argument N.',
    },
  ],
  [
    'CONVERT_TZ',
    {
      parameters: [{ label: 'dt' }, { label: 'from_tz' }, { label: 'to_tz' }],
      returnType: 'DATETIME',
      documentation: 'Converts a datetime value dt from time zone from_tz to to_tz.',
    },
  ],
  [
    'SLEEP',
    {
      parameters: [{ label: 'duration' }],
      returnType: 'INT',
      documentation: 'Sleeps (pauses) for the number of seconds given by duration.',
    },
  ],
  [
    'TO_NUMBER',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'NUMERIC',
      documentation: 'Converts a string to a numeric value (MariaDB/Oracle mode).',
    },
  ],

  // --- Geometry constructors ---
  [
    'GEOMETRYCOLLECTION',
    {
      parameters: [{ label: 'g' }, { label: '...' }],
      returnType: 'GEOMETRYCOLLECTION',
      documentation: 'Constructs a GeometryCollection from geometry arguments.',
    },
  ],
  [
    'LINESTRING',
    {
      parameters: [{ label: 'pt' }, { label: '...' }],
      returnType: 'LINESTRING',
      documentation: 'Constructs a LineString from Point arguments.',
    },
  ],
  [
    'MULTILINESTRING',
    {
      parameters: [{ label: 'ls' }, { label: '...' }],
      returnType: 'MULTILINESTRING',
      documentation: 'Constructs a MultiLineString from LineString arguments.',
    },
  ],
  [
    'MULTIPOINT',
    {
      parameters: [{ label: 'pt' }, { label: '...' }],
      returnType: 'MULTIPOINT',
      documentation: 'Constructs a MultiPoint from Point arguments.',
    },
  ],
  [
    'MULTIPOLYGON',
    {
      parameters: [{ label: 'poly' }, { label: '...' }],
      returnType: 'MULTIPOLYGON',
      documentation: 'Constructs a MultiPolygon from Polygon arguments.',
    },
  ],
  [
    'POINT',
    {
      parameters: [{ label: 'x' }, { label: 'y' }],
      returnType: 'POINT',
      documentation: 'Constructs a Point from x and y coordinates.',
    },
  ],
  [
    'POLYGON',
    {
      parameters: [{ label: 'ls' }, { label: '...' }],
      returnType: 'POLYGON',
      documentation: 'Constructs a Polygon from LineString arguments.',
    },
  ],

  // --- Geometry functions (legacy pre-ST_ aliases) ---
  [
    'AREA',
    {
      parameters: [{ label: 'g' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the area of the Polygon or MultiPolygon g (legacy).',
    },
  ],
  [
    'ASBINARY',
    {
      parameters: [{ label: 'g' }],
      returnType: 'VARBINARY',
      documentation: 'Returns the Well-Known Binary (WKB) representation of g (legacy).',
    },
  ],
  [
    'ASTEXT',
    {
      parameters: [{ label: 'g' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the Well-Known Text (WKT) representation of g (legacy).',
    },
  ],
  [
    'ASWKB',
    {
      parameters: [{ label: 'g' }],
      returnType: 'VARBINARY',
      documentation: 'Synonym for ASBINARY(g) (legacy).',
    },
  ],
  [
    'ASWKT',
    {
      parameters: [{ label: 'g' }],
      returnType: 'VARCHAR',
      documentation: 'Synonym for ASTEXT(g) (legacy).',
    },
  ],
  [
    'BOUNDARY',
    {
      parameters: [{ label: 'g' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the closure of the combinatorial boundary of g (legacy).',
    },
  ],
  [
    'BUFFER',
    {
      parameters: [{ label: 'g' }, { label: 'd' }],
      returnType: 'GEOMETRY',
      documentation:
        'Returns a geometry that represents all points whose distance from g is <= d (legacy).',
    },
  ],
  [
    'CENTROID',
    {
      parameters: [{ label: 'g' }],
      returnType: 'POINT',
      documentation: 'Returns the mathematical centroid for the geometry g (legacy).',
    },
  ],
  [
    'CONTAINS',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 completely contains g2 (legacy).',
    },
  ],
  [
    'CONVEXHULL',
    {
      parameters: [{ label: 'g' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the convex hull of g (legacy).',
    },
  ],
  [
    'CROSSES',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 spatially crosses g2 (legacy).',
    },
  ],
  [
    'DIMENSION',
    {
      parameters: [{ label: 'g' }],
      returnType: 'INT',
      documentation: 'Returns the inherent dimension of g (legacy).',
    },
  ],
  [
    'DISJOINT',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 and g2 have no point in common (legacy).',
    },
  ],
  [
    'ENDPOINT',
    {
      parameters: [{ label: 'ls' }],
      returnType: 'POINT',
      documentation: 'Returns the end Point of LineString ls (legacy).',
    },
  ],
  [
    'ENVELOPE',
    {
      parameters: [{ label: 'g' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the minimum bounding rectangle (MBR) for g (legacy).',
    },
  ],
  [
    'EQUALS',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 and g2 are geometrically equal (legacy).',
    },
  ],
  [
    'EXTERIORRING',
    {
      parameters: [{ label: 'poly' }],
      returnType: 'LINESTRING',
      documentation: 'Returns the exterior ring of the Polygon poly (legacy).',
    },
  ],
  [
    'GEOMCOLLFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'GEOMETRYCOLLECTION',
      documentation: 'Constructs a GeometryCollection from WKT (legacy).',
    },
  ],
  [
    'GEOMCOLLFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'GEOMETRYCOLLECTION',
      documentation: 'Constructs a GeometryCollection from WKB (legacy).',
    },
  ],
  [
    'GEOMETRYCOLLECTIONFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'GEOMETRYCOLLECTION',
      documentation: 'Constructs a GeometryCollection from WKT (legacy).',
    },
  ],
  [
    'GEOMETRYCOLLECTIONFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'GEOMETRYCOLLECTION',
      documentation: 'Constructs a GeometryCollection from WKB (legacy).',
    },
  ],
  [
    'GEOMETRYFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'GEOMETRY',
      documentation: 'Constructs a geometry from WKT (legacy).',
    },
  ],
  [
    'GEOMETRYFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'GEOMETRY',
      documentation: 'Constructs a geometry from WKB (legacy).',
    },
  ],
  [
    'GEOMETRYN',
    {
      parameters: [{ label: 'gc' }, { label: 'N' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the Nth geometry in a GeometryCollection (legacy).',
    },
  ],
  [
    'GEOMETRYTYPE',
    {
      parameters: [{ label: 'g' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the geometry type of g as a string (legacy).',
    },
  ],
  [
    'GEOMFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'GEOMETRY',
      documentation: 'Constructs a geometry from WKT (legacy).',
    },
  ],
  [
    'GEOMFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'GEOMETRY',
      documentation: 'Constructs a geometry from WKB (legacy).',
    },
  ],
  [
    'GLENGTH',
    {
      parameters: [{ label: 'ls' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the length of the LineString ls (legacy).',
    },
  ],
  [
    'INTERIORRINGN',
    {
      parameters: [{ label: 'poly' }, { label: 'N' }],
      returnType: 'LINESTRING',
      documentation: 'Returns the Nth interior ring of the Polygon poly (legacy).',
    },
  ],
  [
    'INTERSECTS',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 spatially intersects g2 (legacy).',
    },
  ],
  [
    'ISCLOSED',
    {
      parameters: [{ label: 'ls' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the LineString ls is closed (legacy).',
    },
  ],
  [
    'ISEMPTY',
    {
      parameters: [{ label: 'g' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g is the empty geometry (legacy).',
    },
  ],
  [
    'ISRING',
    {
      parameters: [{ label: 'ls' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the LineString ls is a ring (legacy).',
    },
  ],
  [
    'ISSIMPLE',
    {
      parameters: [{ label: 'g' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g is a simple geometry (legacy).',
    },
  ],
  [
    'LINEFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'LINESTRING',
      documentation: 'Constructs a LineString from WKT (legacy).',
    },
  ],
  [
    'LINEFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'LINESTRING',
      documentation: 'Constructs a LineString from WKB (legacy).',
    },
  ],
  [
    'LINESTRINGFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'LINESTRING',
      documentation: 'Constructs a LineString from WKT (legacy).',
    },
  ],
  [
    'LINESTRINGFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'LINESTRING',
      documentation: 'Constructs a LineString from WKB (legacy).',
    },
  ],
  [
    'MBRCONTAINS',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the MBR of g1 contains the MBR of g2.',
    },
  ],
  [
    'MBRCOVEREDBY',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the MBR of g1 is covered by the MBR of g2.',
    },
  ],
  [
    'MBRDISJOINT',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the MBRs of g1 and g2 are disjoint.',
    },
  ],
  [
    'MBREQUAL',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the MBRs of g1 and g2 are equal (legacy).',
    },
  ],
  [
    'MBREQUALS',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the MBRs of g1 and g2 are equal.',
    },
  ],
  [
    'MBRINTERSECTS',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the MBRs of g1 and g2 intersect.',
    },
  ],
  [
    'MBROVERLAPS',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the MBRs of g1 and g2 overlap.',
    },
  ],
  [
    'MBRTOUCHES',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the MBRs of g1 and g2 share a boundary but do not overlap.',
    },
  ],
  [
    'MBRWITHIN',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the MBR of g1 is within the MBR of g2.',
    },
  ],
  [
    'MLINEFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'MULTILINESTRING',
      documentation: 'Constructs a MultiLineString from WKT (legacy).',
    },
  ],
  [
    'MLINEFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'MULTILINESTRING',
      documentation: 'Constructs a MultiLineString from WKB (legacy).',
    },
  ],
  [
    'MPOINTFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'MULTIPOINT',
      documentation: 'Constructs a MultiPoint from WKT (legacy).',
    },
  ],
  [
    'MPOINTFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'MULTIPOINT',
      documentation: 'Constructs a MultiPoint from WKB (legacy).',
    },
  ],
  [
    'MPOLYFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'MULTIPOLYGON',
      documentation: 'Constructs a MultiPolygon from WKT (legacy).',
    },
  ],
  [
    'MPOLYFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'MULTIPOLYGON',
      documentation: 'Constructs a MultiPolygon from WKB (legacy).',
    },
  ],
  [
    'MULTILINESTRINGFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'MULTILINESTRING',
      documentation: 'Constructs a MultiLineString from WKT (legacy).',
    },
  ],
  [
    'MULTILINESTRINGFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'MULTILINESTRING',
      documentation: 'Constructs a MultiLineString from WKB (legacy).',
    },
  ],
  [
    'MULTIPOINTFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'MULTIPOINT',
      documentation: 'Constructs a MultiPoint from WKT (legacy).',
    },
  ],
  [
    'MULTIPOINTFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'MULTIPOINT',
      documentation: 'Constructs a MultiPoint from WKB (legacy).',
    },
  ],
  [
    'MULTIPOLYGONFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'MULTIPOLYGON',
      documentation: 'Constructs a MultiPolygon from WKT (legacy).',
    },
  ],
  [
    'MULTIPOLYGONFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'MULTIPOLYGON',
      documentation: 'Constructs a MultiPolygon from WKB (legacy).',
    },
  ],
  [
    'NUMGEOMETRIES',
    {
      parameters: [{ label: 'gc' }],
      returnType: 'INT',
      documentation: 'Returns the number of geometries in the GeometryCollection gc (legacy).',
    },
  ],
  [
    'NUMINTERIORRINGS',
    {
      parameters: [{ label: 'poly' }],
      returnType: 'INT',
      documentation: 'Returns the number of interior rings of the Polygon poly (legacy).',
    },
  ],
  [
    'NUMPOINTS',
    {
      parameters: [{ label: 'ls' }],
      returnType: 'INT',
      documentation: 'Returns the number of Points in the LineString ls (legacy).',
    },
  ],
  [
    'OVERLAPS',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 spatially overlaps g2 (legacy).',
    },
  ],
  [
    'POINTFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'POINT',
      documentation: 'Constructs a Point from WKT (legacy).',
    },
  ],
  [
    'POINTFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'POINT',
      documentation: 'Constructs a Point from WKB (legacy).',
    },
  ],
  [
    'POINTN',
    {
      parameters: [{ label: 'ls' }, { label: 'N' }],
      returnType: 'POINT',
      documentation: 'Returns the Nth Point in the LineString ls (legacy).',
    },
  ],
  [
    'POINTONSURFACE',
    {
      parameters: [{ label: 'g' }],
      returnType: 'POINT',
      documentation: 'Returns a point guaranteed to lie on the surface of g (legacy).',
    },
  ],
  [
    'POLYFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'POLYGON',
      documentation: 'Constructs a Polygon from WKT (legacy).',
    },
  ],
  [
    'POLYFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'POLYGON',
      documentation: 'Constructs a Polygon from WKB (legacy).',
    },
  ],
  [
    'POLYGONFROMTEXT',
    {
      parameters: [{ label: 'wkt' }],
      returnType: 'POLYGON',
      documentation: 'Constructs a Polygon from WKT (legacy).',
    },
  ],
  [
    'POLYGONFROMWKB',
    {
      parameters: [{ label: 'wkb' }],
      returnType: 'POLYGON',
      documentation: 'Constructs a Polygon from WKB (legacy).',
    },
  ],
  [
    'SRID',
    {
      parameters: [{ label: 'g' }],
      returnType: 'INT',
      documentation: 'Returns the Spatial Reference Identifier (SRID) for g (legacy).',
    },
  ],
  [
    'STARTPOINT',
    {
      parameters: [{ label: 'ls' }],
      returnType: 'POINT',
      documentation: 'Returns the start Point of the LineString ls (legacy).',
    },
  ],
  [
    'TOUCHES',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 spatially touches g2 (legacy).',
    },
  ],
  [
    'WITHIN',
    {
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 is spatially within g2 (legacy).',
    },
  ],
  [
    'X',
    {
      parameters: [{ label: 'p' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the X-coordinate of the Point p (legacy).',
    },
  ],
  [
    'Y',
    {
      parameters: [{ label: 'p' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the Y-coordinate of the Point p (legacy).',
    },
  ],

  // --- Geometry functions (ST_ namespace) ---
  [
    'ST_AREA',
    {
      label: 'ST_Area(g)',
      parameters: [{ label: 'g' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the area of the Polygon or MultiPolygon g.',
    },
  ],
  [
    'ST_ASBINARY',
    {
      label: 'ST_AsBinary(g)',
      parameters: [{ label: 'g' }],
      returnType: 'VARBINARY',
      documentation: 'Returns the WKB representation of g.',
    },
  ],
  [
    'ST_ASGEOJSON',
    {
      label: 'ST_AsGeoJSON(g)',
      parameters: [{ label: 'g' }],
      returnType: 'JSON',
      documentation: 'Returns the GeoJSON representation of g.',
    },
  ],
  [
    'ST_ASTEXT',
    {
      label: 'ST_AsText(g)',
      parameters: [{ label: 'g' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the WKT representation of g.',
    },
  ],
  [
    'ST_ASWKB',
    {
      label: 'ST_AsWKB(g)',
      parameters: [{ label: 'g' }],
      returnType: 'VARBINARY',
      documentation: 'Synonym for ST_AsBinary().',
    },
  ],
  [
    'ST_ASWKT',
    {
      label: 'ST_AsWKT(g)',
      parameters: [{ label: 'g' }],
      returnType: 'VARCHAR',
      documentation: 'Synonym for ST_AsText().',
    },
  ],
  [
    'ST_BOUNDARY',
    {
      label: 'ST_Boundary(g)',
      parameters: [{ label: 'g' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the closure of the combinatorial boundary of g.',
    },
  ],
  [
    'ST_BUFFER',
    {
      label: 'ST_Buffer(g, d)',
      parameters: [{ label: 'g' }, { label: 'd' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns a geometry representing all points within distance d from g.',
    },
  ],
  [
    'ST_CENTROID',
    {
      label: 'ST_Centroid(g)',
      parameters: [{ label: 'g' }],
      returnType: 'POINT',
      documentation: 'Returns the mathematical centroid for g.',
    },
  ],
  [
    'ST_COLLECT',
    {
      label: 'ST_Collect(g)',
      parameters: [{ label: 'g' }],
      returnType: 'GEOMETRY',
      documentation: 'Aggregate function that returns a collection of geometry values (MariaDB).',
    },
  ],
  [
    'ST_CONTAINS',
    {
      label: 'ST_Contains(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 completely contains g2.',
    },
  ],
  [
    'ST_CONVEXHULL',
    {
      label: 'ST_ConvexHull(g)',
      parameters: [{ label: 'g' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the convex hull of g.',
    },
  ],
  [
    'ST_CROSSES',
    {
      label: 'ST_Crosses(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 spatially crosses g2.',
    },
  ],
  [
    'ST_DIFFERENCE',
    {
      label: 'ST_Difference(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the point set difference of g1 and g2.',
    },
  ],
  [
    'ST_DIMENSION',
    {
      label: 'ST_Dimension(g)',
      parameters: [{ label: 'g' }],
      returnType: 'INT',
      documentation: 'Returns the inherent dimension of g.',
    },
  ],
  [
    'ST_DISJOINT',
    {
      label: 'ST_Disjoint(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 and g2 have no point in common.',
    },
  ],
  [
    'ST_DISTANCE',
    {
      label: 'ST_Distance(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the distance between g1 and g2.',
    },
  ],
  [
    'ST_DISTANCE_SPHERE',
    {
      label: 'ST_Distance_Sphere(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the minimum spherical distance between two geometries on the Earth.',
    },
  ],
  [
    'ST_ENDPOINT',
    {
      label: 'ST_EndPoint(ls)',
      parameters: [{ label: 'ls' }],
      returnType: 'POINT',
      documentation: 'Returns the end Point of LineString ls.',
    },
  ],
  [
    'ST_ENVELOPE',
    {
      label: 'ST_Envelope(g)',
      parameters: [{ label: 'g' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the minimum bounding rectangle (MBR) for g.',
    },
  ],
  [
    'ST_EQUALS',
    {
      label: 'ST_Equals(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 and g2 are geometrically equal.',
    },
  ],
  [
    'ST_EXTERIORRING',
    {
      label: 'ST_ExteriorRing(poly)',
      parameters: [{ label: 'poly' }],
      returnType: 'LINESTRING',
      documentation: 'Returns the exterior ring of Polygon poly.',
    },
  ],
  [
    'ST_GEOHASH',
    {
      label: 'ST_GeoHash(longitude, latitude, max_length)',
      parameters: [{ label: 'longitude' }, { label: 'latitude' }, { label: 'max_length' }],
      returnType: 'VARCHAR',
      documentation: 'Produces a geohash string.',
    },
  ],
  [
    'ST_GEOMCOLLFROMTEXT',
    {
      label: 'ST_GeomCollFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'GEOMETRYCOLLECTION',
      documentation: 'Constructs a GeometryCollection from WKT.',
    },
  ],
  [
    'ST_GEOMCOLLFROMWKB',
    {
      label: 'ST_GeomCollFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'GEOMETRYCOLLECTION',
      documentation: 'Constructs a GeometryCollection from WKB.',
    },
  ],
  [
    'ST_GEOMETRYCOLLECTIONFROMTEXT',
    {
      label: 'ST_GeometryCollectionFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'GEOMETRYCOLLECTION',
      documentation: 'Constructs a GeometryCollection from WKT.',
    },
  ],
  [
    'ST_GEOMETRYCOLLECTIONFROMWKB',
    {
      label: 'ST_GeometryCollectionFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'GEOMETRYCOLLECTION',
      documentation: 'Constructs a GeometryCollection from WKB.',
    },
  ],
  [
    'ST_GEOMETRYFROMTEXT',
    {
      label: 'ST_GeometryFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'GEOMETRY',
      documentation: 'Constructs a geometry from WKT.',
    },
  ],
  [
    'ST_GEOMETRYFROMWKB',
    {
      label: 'ST_GeometryFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'GEOMETRY',
      documentation: 'Constructs a geometry from WKB.',
    },
  ],
  [
    'ST_GEOMETRYN',
    {
      label: 'ST_GeometryN(gc, N)',
      parameters: [{ label: 'gc' }, { label: 'N' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the Nth geometry in the GeometryCollection gc.',
    },
  ],
  [
    'ST_GEOMETRYTYPE',
    {
      label: 'ST_GeometryType(g)',
      parameters: [{ label: 'g' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the geometry type of g as a string.',
    },
  ],
  [
    'ST_GEOMFROMGEOJSON',
    {
      label: 'ST_GeomFromGeoJSON(str)',
      parameters: [{ label: 'str' }],
      returnType: 'GEOMETRY',
      documentation: 'Parses a GeoJSON string and returns a geometry value.',
    },
  ],
  [
    'ST_GEOMFROMTEXT',
    {
      label: 'ST_GeomFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'GEOMETRY',
      documentation: 'Constructs a geometry from WKT.',
    },
  ],
  [
    'ST_GEOMFROMWKB',
    {
      label: 'ST_GeomFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'GEOMETRY',
      documentation: 'Constructs a geometry from WKB.',
    },
  ],
  [
    'ST_INTERIORRINGN',
    {
      label: 'ST_InteriorRingN(poly, N)',
      parameters: [{ label: 'poly' }, { label: 'N' }],
      returnType: 'LINESTRING',
      documentation: 'Returns the Nth interior ring of Polygon poly.',
    },
  ],
  [
    'ST_INTERSECTION',
    {
      label: 'ST_Intersection(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the point set intersection of g1 and g2.',
    },
  ],
  [
    'ST_INTERSECTS',
    {
      label: 'ST_Intersects(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 spatially intersects g2.',
    },
  ],
  [
    'ST_ISCLOSED',
    {
      label: 'ST_IsClosed(ls)',
      parameters: [{ label: 'ls' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the LineString ls is closed.',
    },
  ],
  [
    'ST_ISEMPTY',
    {
      label: 'ST_IsEmpty(g)',
      parameters: [{ label: 'g' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g is the empty geometry.',
    },
  ],
  [
    'ST_ISRING',
    {
      label: 'ST_IsRing(ls)',
      parameters: [{ label: 'ls' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the LineString ls is a ring.',
    },
  ],
  [
    'ST_ISSIMPLE',
    {
      label: 'ST_IsSimple(g)',
      parameters: [{ label: 'g' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g is a simple geometry.',
    },
  ],
  [
    'ST_ISVALID',
    {
      label: 'ST_IsValid(g)',
      parameters: [{ label: 'g' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g is a valid geometry.',
    },
  ],
  [
    'ST_LATFROMGEOHASH',
    {
      label: 'ST_LatFromGeoHash(geohash_str)',
      parameters: [{ label: 'geohash_str' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the latitude value from a geohash string.',
    },
  ],
  [
    'ST_LENGTH',
    {
      label: 'ST_Length(ls)',
      parameters: [{ label: 'ls' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the length of the LineString ls.',
    },
  ],
  [
    'ST_LINEFROMTEXT',
    {
      label: 'ST_LineFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'LINESTRING',
      documentation: 'Constructs a LineString from WKT.',
    },
  ],
  [
    'ST_LINEFROMWKB',
    {
      label: 'ST_LineFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'LINESTRING',
      documentation: 'Constructs a LineString from WKB.',
    },
  ],
  [
    'ST_LINESTRINGFROMTEXT',
    {
      label: 'ST_LineStringFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'LINESTRING',
      documentation: 'Constructs a LineString from WKT.',
    },
  ],
  [
    'ST_LINESTRINGFROMWKB',
    {
      label: 'ST_LineStringFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'LINESTRING',
      documentation: 'Constructs a LineString from WKB.',
    },
  ],
  [
    'ST_LONGFROMGEOHASH',
    {
      label: 'ST_LongFromGeoHash(geohash_str)',
      parameters: [{ label: 'geohash_str' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the longitude value from a geohash string.',
    },
  ],
  [
    'ST_MLINEFROMTEXT',
    {
      label: 'ST_MLineFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'MULTILINESTRING',
      documentation: 'Constructs a MultiLineString from WKT.',
    },
  ],
  [
    'ST_MLINEFROMWKB',
    {
      label: 'ST_MLineFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'MULTILINESTRING',
      documentation: 'Constructs a MultiLineString from WKB.',
    },
  ],
  [
    'ST_MPOINTFROMTEXT',
    {
      label: 'ST_MPointFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'MULTIPOINT',
      documentation: 'Constructs a MultiPoint from WKT.',
    },
  ],
  [
    'ST_MPOINTFROMWKB',
    {
      label: 'ST_MPointFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'MULTIPOINT',
      documentation: 'Constructs a MultiPoint from WKB.',
    },
  ],
  [
    'ST_MPOLYFROMTEXT',
    {
      label: 'ST_MPolyFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'MULTIPOLYGON',
      documentation: 'Constructs a MultiPolygon from WKT.',
    },
  ],
  [
    'ST_MPOLYFROMWKB',
    {
      label: 'ST_MPolyFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'MULTIPOLYGON',
      documentation: 'Constructs a MultiPolygon from WKB.',
    },
  ],
  [
    'ST_MULTILINESTRINGFROMTEXT',
    {
      label: 'ST_MultiLineStringFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'MULTILINESTRING',
      documentation: 'Constructs a MultiLineString from WKT.',
    },
  ],
  [
    'ST_MULTILINESTRINGFROMWKB',
    {
      label: 'ST_MultiLineStringFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'MULTILINESTRING',
      documentation: 'Constructs a MultiLineString from WKB.',
    },
  ],
  [
    'ST_MULTIPOINTFROMTEXT',
    {
      label: 'ST_MultiPointFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'MULTIPOINT',
      documentation: 'Constructs a MultiPoint from WKT.',
    },
  ],
  [
    'ST_MULTIPOINTFROMWKB',
    {
      label: 'ST_MultiPointFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'MULTIPOINT',
      documentation: 'Constructs a MultiPoint from WKB.',
    },
  ],
  [
    'ST_MULTIPOLYGONFROMTEXT',
    {
      label: 'ST_MultiPolygonFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'MULTIPOLYGON',
      documentation: 'Constructs a MultiPolygon from WKT.',
    },
  ],
  [
    'ST_MULTIPOLYGONFROMWKB',
    {
      label: 'ST_MultiPolygonFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'MULTIPOLYGON',
      documentation: 'Constructs a MultiPolygon from WKB.',
    },
  ],
  [
    'ST_NUMGEOMETRIES',
    {
      label: 'ST_NumGeometries(gc)',
      parameters: [{ label: 'gc' }],
      returnType: 'INT',
      documentation: 'Returns the number of geometries in the GeometryCollection gc.',
    },
  ],
  [
    'ST_NUMINTERIORRINGS',
    {
      label: 'ST_NumInteriorRings(poly)',
      parameters: [{ label: 'poly' }],
      returnType: 'INT',
      documentation: 'Returns the number of interior rings of Polygon poly.',
    },
  ],
  [
    'ST_NUMPOINTS',
    {
      label: 'ST_NumPoints(ls)',
      parameters: [{ label: 'ls' }],
      returnType: 'INT',
      documentation: 'Returns the number of Points in the LineString ls.',
    },
  ],
  [
    'ST_OVERLAPS',
    {
      label: 'ST_Overlaps(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 spatially overlaps g2.',
    },
  ],
  [
    'ST_POINTFROMGEOHASH',
    {
      label: 'ST_PointFromGeoHash(geohash_str, srid)',
      parameters: [{ label: 'geohash_str' }, { label: 'srid' }],
      returnType: 'POINT',
      documentation: 'Returns a POINT value from a geohash string.',
    },
  ],
  [
    'ST_POINTFROMTEXT',
    {
      label: 'ST_PointFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'POINT',
      documentation: 'Constructs a Point from WKT.',
    },
  ],
  [
    'ST_POINTFROMWKB',
    {
      label: 'ST_PointFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'POINT',
      documentation: 'Constructs a Point from WKB.',
    },
  ],
  [
    'ST_POINTN',
    {
      label: 'ST_PointN(ls, N)',
      parameters: [{ label: 'ls' }, { label: 'N' }],
      returnType: 'POINT',
      documentation: 'Returns the Nth Point in the LineString ls.',
    },
  ],
  [
    'ST_POINTONSURFACE',
    {
      label: 'ST_PointOnSurface(g)',
      parameters: [{ label: 'g' }],
      returnType: 'POINT',
      documentation: 'Returns a point guaranteed to lie on the surface of g.',
    },
  ],
  [
    'ST_POLYFROMTEXT',
    {
      label: 'ST_PolyFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'POLYGON',
      documentation: 'Constructs a Polygon from WKT.',
    },
  ],
  [
    'ST_POLYFROMWKB',
    {
      label: 'ST_PolyFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'POLYGON',
      documentation: 'Constructs a Polygon from WKB.',
    },
  ],
  [
    'ST_POLYGONFROMTEXT',
    {
      label: 'ST_PolygonFromText(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'POLYGON',
      documentation: 'Constructs a Polygon from WKT.',
    },
  ],
  [
    'ST_POLYGONFROMWKB',
    {
      label: 'ST_PolygonFromWKB(wkb)',
      parameters: [{ label: 'wkb' }],
      returnType: 'POLYGON',
      documentation: 'Constructs a Polygon from WKB.',
    },
  ],
  [
    'ST_RELATE',
    {
      label: 'ST_Relate(g1, g2, matrix)',
      parameters: [{ label: 'g1' }, { label: 'g2' }, { label: 'matrix' }],
      returnType: 'INT',
      documentation: 'Tests spatial relation between g1 and g2 using the DE-9IM matrix.',
    },
  ],
  [
    'ST_SIMPLIFY',
    {
      label: 'ST_Simplify(g, max_distance)',
      parameters: [{ label: 'g' }, { label: 'max_distance' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns a simplified version of g.',
    },
  ],
  [
    'ST_SRID',
    {
      parameters: [{ label: 'g' }],
      returnType: 'INT',
      documentation: 'Returns the Spatial Reference Identifier (SRID) for g.',
    },
  ],
  [
    'ST_STARTPOINT',
    {
      label: 'ST_StartPoint(ls)',
      parameters: [{ label: 'ls' }],
      returnType: 'POINT',
      documentation: 'Returns the start Point of LineString ls.',
    },
  ],
  [
    'ST_SYMDIFFERENCE',
    {
      label: 'ST_SymDifference(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the point set symmetric difference of g1 and g2.',
    },
  ],
  [
    'ST_TOUCHES',
    {
      label: 'ST_Touches(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 spatially touches g2.',
    },
  ],
  [
    'ST_UNION',
    {
      label: 'ST_Union(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the point set union of g1 and g2.',
    },
  ],
  [
    'ST_VALIDATE',
    {
      label: 'ST_Validate(g)',
      parameters: [{ label: 'g' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns a validated version of g.',
    },
  ],
  [
    'ST_WITHIN',
    {
      label: 'ST_Within(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if g1 is spatially within g2.',
    },
  ],
  [
    'ST_X',
    {
      parameters: [{ label: 'p' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the X-coordinate of the Point p.',
    },
  ],
  [
    'ST_Y',
    {
      parameters: [{ label: 'p' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the Y-coordinate of the Point p.',
    },
  ],

  // --- MySQL-specific built-ins ---
  [
    'ANY_VALUE',
    {
      parameters: [{ label: 'arg' }],
      returnType: 'mixed',
      documentation:
        'Suppresses ONLY_FULL_GROUP_BY rejection of a query; returns an arbitrary value from the group.',
    },
  ],
  [
    'ASYNCHRONOUS_CONNECTION_FAILOVER_ADD_MANAGED',
    {
      parameters: [
        { label: 'channel' },
        { label: 'managed_type' },
        { label: 'managed_name' },
        { label: 'primary_weight' },
        { label: 'secondary_weight' },
      ],
      returnType: 'VARCHAR',
      documentation: 'Adds a managed source to the replication failover source list (MySQL GR).',
    },
  ],
  [
    'ASYNCHRONOUS_CONNECTION_FAILOVER_ADD_SOURCE',
    {
      parameters: [
        { label: 'channel' },
        { label: 'host' },
        { label: 'port' },
        { label: 'network_namespace' },
        { label: 'weight' },
      ],
      returnType: 'VARCHAR',
      documentation: 'Adds a source to the replication failover source list (MySQL).',
    },
  ],
  [
    'ASYNCHRONOUS_CONNECTION_FAILOVER_DELETE_MANAGED',
    {
      parameters: [{ label: 'channel' }, { label: 'managed_name' }],
      returnType: 'VARCHAR',
      documentation:
        'Removes a managed source from the replication failover source list (MySQL GR).',
    },
  ],
  [
    'ASYNCHRONOUS_CONNECTION_FAILOVER_DELETE_SOURCE',
    {
      parameters: [
        { label: 'channel' },
        { label: 'host' },
        { label: 'port' },
        { label: 'network_namespace' },
      ],
      returnType: 'VARCHAR',
      documentation: 'Removes a source from the replication failover source list (MySQL).',
    },
  ],
  [
    'ASYNCHRONOUS_CONNECTION_FAILOVER_RESET',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Resets the asynchronous connection failover feature (MySQL).',
    },
  ],
  [
    'BIN_TO_UUID',
    {
      parameters: [{ label: 'binary_uuid' }],
      returnType: 'VARCHAR',
      documentation: 'Converts a binary UUID to a string UUID.',
    },
  ],
  [
    'GEOMCOLLECTION',
    {
      parameters: [{ label: 'g' }, { label: '...' }],
      returnType: 'GEOMETRYCOLLECTION',
      documentation: 'Constructs a GeometryCollection (MySQL synonym for GEOMETRYCOLLECTION).',
    },
  ],
  [
    'GROUP_REPLICATION_DISABLE_MEMBER_ACTION',
    {
      parameters: [{ label: 'name' }, { label: 'event' }],
      returnType: 'VARCHAR',
      documentation: 'Disables a Group Replication member action (MySQL GR).',
    },
  ],
  [
    'GROUP_REPLICATION_ENABLE_MEMBER_ACTION',
    {
      parameters: [{ label: 'name' }, { label: 'event' }],
      returnType: 'VARCHAR',
      documentation: 'Enables a Group Replication member action (MySQL GR).',
    },
  ],
  [
    'GROUP_REPLICATION_GET_COMMUNICATION_PROTOCOL',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation:
        'Returns the communication protocol version used by Group Replication (MySQL GR).',
    },
  ],
  [
    'GROUP_REPLICATION_GET_WRITE_CONCURRENCY',
    {
      parameters: [],
      returnType: 'INT',
      documentation: 'Returns the maximum number of consensus instances in flight (MySQL GR).',
    },
  ],
  [
    'GROUP_REPLICATION_RESET_MEMBER_ACTIONS',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Resets all member actions to their default configuration (MySQL GR).',
    },
  ],
  [
    'GROUP_REPLICATION_SET_AS_PRIMARY',
    {
      parameters: [{ label: 'member_uuid' }],
      returnType: 'VARCHAR',
      documentation: 'Appoints the group member with the given UUID as the new primary (MySQL GR).',
    },
  ],
  [
    'GROUP_REPLICATION_SET_COMMUNICATION_PROTOCOL',
    {
      parameters: [{ label: 'version' }],
      returnType: 'VARCHAR',
      documentation: 'Sets the communication protocol version for Group Replication (MySQL GR).',
    },
  ],
  [
    'GROUP_REPLICATION_SET_WRITE_CONCURRENCY',
    {
      parameters: [{ label: 'instances' }],
      returnType: 'VARCHAR',
      documentation: 'Sets the maximum number of consensus instances in flight (MySQL GR).',
    },
  ],
  [
    'GROUP_REPLICATION_SWITCH_TO_MULTI_PRIMARY_MODE',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Switches Group Replication to multi-primary mode (MySQL GR).',
    },
  ],
  [
    'GROUP_REPLICATION_SWITCH_TO_SINGLE_PRIMARY_MODE',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Switches Group Replication to single-primary mode (MySQL GR).',
    },
  ],
  [
    'GROUPING',
    {
      parameters: [{ label: 'expr' }],
      returnType: 'INT',
      documentation:
        'Returns 1 when the expression is NULL due to a ROLLUP operation; 0 otherwise.',
    },
  ],
  [
    'ICU_VERSION',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation:
        'Returns the version of the ICU library used by MySQL for regular expressions.',
    },
  ],
  [
    'IS_UUID',
    {
      parameters: [{ label: 'string_uuid' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the argument is a valid string-format UUID, 0 if not.',
    },
  ],
  [
    'JSON_SCHEMA_VALIDATION_REPORT',
    {
      parameters: [{ label: 'schema' }, { label: 'document' }],
      returnType: 'JSON',
      documentation: 'Validates a document against a JSON schema and returns a detailed report.',
    },
  ],
  [
    'JSON_STORAGE_FREE',
    {
      parameters: [{ label: 'json_val' }],
      returnType: 'INT',
      documentation: 'Returns the amount of storage freed in a JSON column after a partial update.',
    },
  ],
  [
    'JSON_STORAGE_SIZE',
    {
      parameters: [{ label: 'json_val' }],
      returnType: 'INT',
      documentation: 'Returns the storage space in bytes used for the binary JSON document.',
    },
  ],
  [
    'MATCH',
    {
      parameters: [{ label: 'col, ...) AGAINST(expr' }],
      returnType: 'DOUBLE',
      documentation:
        'Full-text search. Syntax: MATCH(col1,...) AGAINST(expr [IN BOOLEAN MODE|IN NATURAL LANGUAGE MODE])',
    },
  ],
  [
    'MBRCOVERS',
    {
      label: 'MBRCovers(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'INT',
      documentation: 'Returns 1 if the MBR of g1 covers the MBR of g2 (MySQL).',
    },
  ],
  [
    'PS_CURRENT_THREAD_ID',
    {
      parameters: [],
      returnType: 'BIGINT',
      documentation: 'Returns the Performance Schema thread ID for the current thread (MySQL).',
    },
  ],
  [
    'PS_THREAD_ID',
    {
      parameters: [{ label: 'connection_id' }],
      returnType: 'BIGINT',
      documentation:
        'Returns the Performance Schema thread ID for the given connection ID (MySQL).',
    },
  ],
  [
    'RANDOM_BYTES',
    {
      parameters: [{ label: 'len' }],
      returnType: 'VARBINARY',
      documentation:
        'Returns a binary string of len random bytes generated using a random number generator.',
    },
  ],
  [
    'REGEXP_INSTR',
    {
      parameters: [
        { label: 'expr', documentation: 'The string to search.' },
        { label: 'pat', documentation: 'The regular expression pattern.' },
        { label: 'pos (optional)', documentation: 'Starting position.' },
        { label: 'occurrence (optional)', documentation: 'Which match to find.' },
        { label: 'return_option (optional)', documentation: '0 = start, 1 = end.' },
        { label: 'match_type (optional)', documentation: 'Match type flags.' },
      ],
      returnType: 'INT',
      documentation:
        'Returns the starting index of the substring of expr that matches the regular expression pat.',
    },
  ],
  [
    'REGEXP_LIKE',
    {
      parameters: [
        { label: 'expr', documentation: 'The string to test.' },
        { label: 'pat', documentation: 'The regular expression pattern.' },
        { label: 'match_type (optional)', documentation: 'Match type flags.' },
      ],
      returnType: 'INT',
      documentation: 'Returns 1 if the string expr matches the regular expression pat.',
    },
  ],
  [
    'REGEXP_REPLACE',
    {
      parameters: [
        { label: 'expr', documentation: 'The string to search.' },
        { label: 'pat', documentation: 'The regular expression pattern.' },
        { label: 'repl', documentation: 'The replacement string.' },
        { label: 'pos (optional)', documentation: 'Position to start. Default 1.' },
        { label: 'occurrence (optional)', documentation: 'Which match to replace. 0 = all.' },
        {
          label: 'match_type (optional)',
          documentation: 'Match type flags (c, i, m, n, u).',
        },
      ],
      returnType: 'VARCHAR',
      documentation:
        'Replaces occurrences in expr that match the regular expression pat with repl.',
    },
  ],
  [
    'REGEXP_SUBSTR',
    {
      parameters: [
        { label: 'expr', documentation: 'The string to search.' },
        { label: 'pat', documentation: 'The regular expression pattern.' },
        { label: 'pos (optional)', documentation: 'Starting position.' },
        { label: 'occurrence (optional)', documentation: 'Which match to return.' },
        { label: 'match_type (optional)', documentation: 'Match type flags.' },
      ],
      returnType: 'VARCHAR',
      documentation: 'Returns the substring of expr that matches the regular expression pat.',
    },
  ],
  [
    'RELEASE_ALL_LOCKS',
    {
      parameters: [],
      returnType: 'INT',
      documentation: 'Releases all current named locks held by the current session.',
    },
  ],
  [
    'ROLES_GRAPHML',
    {
      parameters: [],
      returnType: 'VARCHAR',
      documentation: 'Returns a GraphML document representing memory role subgraphs (MySQL).',
    },
  ],
  [
    'SOURCE_POS_WAIT',
    {
      parameters: [{ label: 'log_name' }, { label: 'log_pos' }],
      returnType: 'INT',
      documentation:
        'Blocks until the replica has applied all updates to the specified source binary log position.',
    },
  ],
  [
    'ST_BUFFER_STRATEGY',
    {
      label: 'ST_Buffer_Strategy(strategy)',
      parameters: [{ label: 'strategy' }],
      returnType: 'VARBINARY',
      documentation: 'Produces a strategy object for use with ST_Buffer() (MySQL).',
    },
  ],
  [
    'ST_FRECHETDISTANCE',
    {
      label: 'ST_FrechetDistance(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the discrete Frechet distance between two geometries (MySQL).',
    },
  ],
  [
    'ST_GEOMCOLLFROMTXT',
    {
      label: 'ST_GeomCollFromTxt(wkt)',
      parameters: [{ label: 'wkt' }],
      returnType: 'GEOMETRYCOLLECTION',
      documentation: 'Constructs a GeometryCollection from WKT (MySQL synonym).',
    },
  ],
  [
    'ST_HAUSDORFFDISTANCE',
    {
      label: 'ST_HausdorffDistance(g1, g2)',
      parameters: [{ label: 'g1' }, { label: 'g2' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the discrete Hausdorff distance between two geometries (MySQL).',
    },
  ],
  [
    'ST_LATITUDE',
    {
      label: 'ST_Latitude(p)',
      parameters: [{ label: 'p' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the latitude of the Point p (MySQL).',
    },
  ],
  [
    'ST_LINEINTERPOLATEPOINT',
    {
      label: 'ST_LineInterpolatePoint(ls, fractional_distance)',
      parameters: [{ label: 'ls' }, { label: 'fractional_distance' }],
      returnType: 'POINT',
      documentation:
        'Returns the point along the LineString ls at the given fractional distance (MySQL).',
    },
  ],
  [
    'ST_LINEINTERPOLATEPOINTS',
    {
      label: 'ST_LineInterpolatePoints(ls, fractional_distance)',
      parameters: [{ label: 'ls' }, { label: 'fractional_distance' }],
      returnType: 'MULTIPOINT',
      documentation:
        'Returns the set of points along the LineString ls at each fractional distance interval (MySQL).',
    },
  ],
  [
    'ST_LONGITUDE',
    {
      label: 'ST_Longitude(p)',
      parameters: [{ label: 'p' }],
      returnType: 'DOUBLE',
      documentation: 'Returns the longitude of the Point p (MySQL).',
    },
  ],
  [
    'ST_MAKEENVELOPE',
    {
      label: 'ST_MakeEnvelope(pt1, pt2)',
      parameters: [{ label: 'pt1' }, { label: 'pt2' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns a rectangle on a sphere using two Points (MySQL).',
    },
  ],
  [
    'ST_NUMINTERIORRING',
    {
      label: 'ST_NumInteriorRing(poly)',
      parameters: [{ label: 'poly' }],
      returnType: 'INT',
      documentation: 'Synonym for ST_NumInteriorRings() (MySQL).',
    },
  ],
  [
    'ST_POINTATDISTANCE',
    {
      label: 'ST_PointAtDistance(ls, distance)',
      parameters: [{ label: 'ls' }, { label: 'distance' }],
      returnType: 'POINT',
      documentation:
        'Returns a Point on the LineString ls at the given distance from the start (MySQL).',
    },
  ],
  [
    'ST_SWAPXY',
    {
      label: 'ST_SwapXY(g)',
      parameters: [{ label: 'g' }],
      returnType: 'GEOMETRY',
      documentation: 'Returns the geometry g with X and Y coordinates swapped (MySQL).',
    },
  ],
  [
    'ST_TRANSFORM',
    {
      label: 'ST_Transform(g, target_srid)',
      parameters: [{ label: 'g' }, { label: 'target_srid' }],
      returnType: 'GEOMETRY',
      documentation: 'Transforms a geometry from one SRS to another (MySQL).',
    },
  ],
  [
    'STATEMENT_DIGEST',
    {
      parameters: [{ label: 'statement' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the hash digest for the given statement (MySQL).',
    },
  ],
  [
    'STATEMENT_DIGEST_TEXT',
    {
      parameters: [{ label: 'statement' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the normalized statement digest for the given statement (MySQL).',
    },
  ],
  [
    'UUID_TO_BIN',
    {
      parameters: [{ label: 'string_uuid' }],
      returnType: 'VARBINARY',
      documentation: 'Converts a string UUID to a binary UUID.',
    },
  ],
  [
    'VALIDATE_PASSWORD_STRENGTH',
    {
      parameters: [{ label: 'str' }],
      returnType: 'INT',
      documentation: 'Returns an integer indicating how strong the given password is (0–100).',
    },
  ],
  [
    'VALUES',
    {
      parameters: [{ label: 'col_name' }],
      returnType: 'mixed',
      documentation:
        'In INSERT...ON DUPLICATE KEY UPDATE, returns the value that would be inserted for a column.',
    },
  ],
  [
    'WAIT_FOR_EXECUTED_GTID_SET',
    {
      parameters: [{ label: 'gtid_set' }, { label: 'timeout' }],
      returnType: 'INT',
      documentation: 'Waits until the server has applied all GTIDs in the given gtid set (MySQL).',
    },
  ],
])

export function getBuiltinSignature(
  name: string
): (BuiltinFunctionSignature & { label: string }) | undefined {
  const key = name.toUpperCase()
  const sig = BUILTIN_FUNCTION_SIGNATURES.get(key)
  if (!sig) return undefined
  return { ...sig, label: getSignatureLabel(key, sig) }
}
