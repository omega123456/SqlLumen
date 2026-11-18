import type { DropdownOption } from '../../common/Dropdown'
import type { SslMode } from '../../../types/connection'
import type { SslPathField } from './connection-editor-state'

export const SSL_MODE_LABEL: Record<SslMode, string> = {
  disabled: 'Disabled',
  preferred: 'Preferred',
  required: 'Required',
  verify_ca: 'Verify CA',
  verify_identity: 'Verify identity',
}

export const SSL_MODE_DESCRIPTION: Record<SslMode, string> = {
  disabled: 'Connect without encryption.',
  preferred: 'Encrypt when the server supports it.',
  required: 'Always encrypt, without checking the certificate.',
  verify_ca: 'Check the server certificate against a CA.',
  verify_identity: 'Also check the certificate matches the host.',
}

const SSL_MODES: SslMode[] = ['disabled', 'preferred', 'required', 'verify_ca', 'verify_identity']

export const SSL_MODE_OPTIONS: DropdownOption<SslMode>[] = SSL_MODES.map((mode) => ({
  value: mode,
  label: SSL_MODE_LABEL[mode],
  description: SSL_MODE_DESCRIPTION[mode],
}))

const CLIENT_IDENTITY_FIELDS: SslPathField[] = ['sslCertPath', 'sslKeyPath']
const VERIFYING_FIELDS: SslPathField[] = ['sslCaPath', ...CLIENT_IDENTITY_FIELDS]

export const SSL_FILE_FIELDS_BY_MODE: Record<SslMode, SslPathField[]> = {
  disabled: [],
  preferred: CLIENT_IDENTITY_FIELDS,
  required: CLIENT_IDENTITY_FIELDS,
  verify_ca: VERIFYING_FIELDS,
  verify_identity: VERIFYING_FIELDS,
}
