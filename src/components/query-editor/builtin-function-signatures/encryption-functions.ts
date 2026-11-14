import type { BuiltinSignatureEntry } from './signature-types'

export const ENCRYPTION_FUNCTION_SIGNATURES: readonly BuiltinSignatureEntry[] = [
  [
    'AES_DECRYPT',
    {
      parameters: [{ label: 'crypt_str' }, { label: 'key_str' }],
      returnType: 'VARBINARY',
      documentation: 'Decrypts data using the AES algorithm.',
    },
  ],
  [
    'AES_ENCRYPT',
    {
      parameters: [{ label: 'str' }, { label: 'key_str' }],
      returnType: 'VARBINARY',
      documentation: 'Encrypts data using the AES algorithm.',
    },
  ],
  [
    'COMPRESS',
    {
      parameters: [{ label: 'string_to_compress' }],
      returnType: 'VARBINARY',
      documentation: 'Compresses a string and returns the result as a binary string.',
    },
  ],
  [
    'DES_DECRYPT',
    {
      parameters: [{ label: 'crypt_str' }],
      returnType: 'VARCHAR',
      documentation: 'Decrypts a string encrypted with DES_ENCRYPT().',
    },
  ],
  [
    'DES_ENCRYPT',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARBINARY',
      documentation: 'Encrypts the string with the Triple-DES algorithm.',
    },
  ],
  [
    'DECODE',
    {
      parameters: [{ label: 'crypt_str' }, { label: 'pass_str' }],
      returnType: 'VARCHAR',
      documentation: 'Decrypts the encrypted string using pass_str as the password.',
    },
  ],
  [
    'ENCODE',
    {
      parameters: [{ label: 'str' }, { label: 'pass_str' }],
      returnType: 'VARBINARY',
      documentation: 'Encrypts str using pass_str as the password.',
    },
  ],
  [
    'ENCRYPT',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARCHAR',
      documentation: 'Encrypts str using the Unix crypt() system call.',
    },
  ],
  [
    'KDF',
    {
      parameters: [{ label: 'key_str' }, { label: 'salt' }, { label: 'info' }],
      returnType: 'VARBINARY',
      documentation: 'Key derivation function (MariaDB 11.x+).',
    },
  ],
  [
    'MD5',
    {
      parameters: [{ label: 'str', documentation: 'The string to hash.' }],
      returnType: 'VARCHAR',
      documentation: 'Computes an MD5 128-bit checksum for the string.',
    },
  ],
  [
    'OLD_PASSWORD',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARCHAR',
      documentation: 'Returns the pre-4.1 password hash. Deprecated.',
    },
  ],
  [
    'PASSWORD',
    {
      parameters: [{ label: 'str' }],
      returnType: 'VARCHAR',
      documentation: 'Computes a MySQL password hash from str.',
    },
  ],
  [
    'SHA',
    {
      parameters: [{ label: 'str', documentation: 'The string to hash.' }],
      returnType: 'VARCHAR',
      documentation: 'Calculates an SHA-1 160-bit checksum for the string.',
    },
  ],
  [
    'SHA1',
    {
      parameters: [{ label: 'str', documentation: 'The string to hash.' }],
      returnType: 'VARCHAR',
      documentation: 'Calculates an SHA-1 160-bit checksum for the string.',
    },
  ],
  [
    'SHA2',
    {
      parameters: [
        { label: 'str', documentation: 'The string to hash.' },
        {
          label: 'hash_length',
          documentation: 'Hash bit length (224, 256, 384, or 512).',
        },
      ],
      returnType: 'VARCHAR',
      documentation:
        'Computes the SHA-2 family of hash functions. hash_length: 224, 256, 384, or 512.',
    },
  ],
]
