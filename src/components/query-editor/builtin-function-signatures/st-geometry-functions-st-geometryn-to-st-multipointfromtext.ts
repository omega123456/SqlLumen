import type { BuiltinSignatureEntry } from './signature-types'

export const ST_GEOMETRY_FUNCTION_ST_GEOMETRYN_TO_ST_MULTIPOINTFROMTEXT_SIGNATURES: readonly BuiltinSignatureEntry[] =
  [
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
  ]
