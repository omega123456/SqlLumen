import type { BuiltinSignatureEntry } from './signature-types'

export const LEGACY_GEOMETRY_FUNCTION_MBRCOVEREDBY_TO_Y_SIGNATURES: readonly BuiltinSignatureEntry[] =
  [
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
  ]
