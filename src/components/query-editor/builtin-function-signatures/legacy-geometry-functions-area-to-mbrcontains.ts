import type { BuiltinSignatureEntry } from './signature-types'

export const LEGACY_GEOMETRY_FUNCTION_AREA_TO_MBRCONTAINS_SIGNATURES: readonly BuiltinSignatureEntry[] =
  [
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
  ]
