import type { BuiltinSignatureEntry } from './signature-types'

export const MYSQL_SPECIFIC_FUNCTION_REGEXP_INSTR_TO_WAIT_FOR_EXECUTED_GTID_SET_SIGNATURES: readonly BuiltinSignatureEntry[] =
  [
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
        documentation:
          'Waits until the server has applied all GTIDs in the given gtid set (MySQL).',
      },
    ],
  ]
