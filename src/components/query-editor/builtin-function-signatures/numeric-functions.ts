import type { BuiltinSignatureEntry } from './signature-types'

export const NUMERIC_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
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
]
