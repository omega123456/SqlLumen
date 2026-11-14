import type { BuiltinSignatureEntry } from './signature-types'

export const GEOMETRY_CONSTRUCTORS_SIGNATURES: readonly BuiltinSignatureEntry[] = [
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
]
