import type { BlobValueResponse } from '../../types/schema'

/**
 * Default `fetch_blob_value` fixture: a tiny 1x1 transparent PNG so the dialog's
 * Image tab has renderable bytes in E2E flows. Base64 of the PNG below decodes
 * to 70 bytes.
 */
export const DEFAULT_BLOB_VALUE: BlobValueResponse = {
  base64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  byteLength: 70,
  tooLarge: false,
}

/** A NULL binary cell. */
export const NULL_BLOB_VALUE: BlobValueResponse = {
  base64: null,
  byteLength: 0,
  tooLarge: false,
}

/** A zero-byte (empty) binary cell — present but holds no bytes. */
export const EMPTY_BLOB_VALUE: BlobValueResponse = {
  base64: '',
  byteLength: 0,
  tooLarge: false,
}

/** A blob that exceeds the 10 MB preview cap (bytes withheld). */
export const TOO_LARGE_BLOB_VALUE: BlobValueResponse = {
  base64: null,
  byteLength: 12 * 1024 * 1024,
  tooLarge: true,
}

export const BLOB_VIEWER_SCREENSHOT_STATES = {
  null: NULL_BLOB_VALUE,
  empty: EMPTY_BLOB_VALUE,
  tooLarge: TOO_LARGE_BLOB_VALUE,
} satisfies Record<'null' | 'empty' | 'tooLarge', BlobValueResponse>

export const DEFAULT_BLOB_VALUE_BY_KEY: Record<string, BlobValueResponse> = {
  default: DEFAULT_BLOB_VALUE,
  photo: DEFAULT_BLOB_VALUE,
  photo_large: TOO_LARGE_BLOB_VALUE,
  photo_null: NULL_BLOB_VALUE,
  photo_empty: EMPTY_BLOB_VALUE,
}
