import type { BuiltinSignatureEntry } from './signature-types'

export const ST_GEOMETRY_FUNCTION_ST_MULTIPOINTFROMWKB_TO_ST_Y_SIGNATURES: readonly BuiltinSignatureEntry[] =
  [
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
  ]
