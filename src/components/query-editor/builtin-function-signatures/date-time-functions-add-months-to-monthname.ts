import type { BuiltinSignatureEntry } from './signature-types'

export const DATE_TIME_FUNCTION_ADD_MONTHS_TO_MONTHNAME_SIGNATURES: readonly BuiltinSignatureEntry[] =
  [
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
        documentation:
          'Extracts part of a date. unit: YEAR, MONTH, DAY, HOUR, MINUTE, SECOND, etc.',
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
        documentation:
          'Returns a time value calculated from the hour, minute, and second arguments.',
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
  ]
