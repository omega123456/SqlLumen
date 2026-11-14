import type { BuiltinSignatureEntry } from './signature-types'

export const DATE_TIME_FUNCTION_NOW_TO_YEARWEEK_SIGNATURES: readonly BuiltinSignatureEntry[] = [
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
]
