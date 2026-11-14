import type { BuiltinSignatureEntry } from './signature-types'

export const ST_GEOMETRY_FUNCTION_ST_AREA_TO_ST_GEOMETRYFROMWKB_SIGNATURES: readonly BuiltinSignatureEntry[] =
  [
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
        documentation:
          'Returns the minimum spherical distance between two geometries on the Earth.',
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
  ]
