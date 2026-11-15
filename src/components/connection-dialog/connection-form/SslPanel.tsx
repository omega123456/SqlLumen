import { Checkbox } from '../../common/Checkbox'
import type { SslPathField } from '../connection-editor-state'
import { SslFileField, type FormFields } from './form-fields'
import { CONNECTION_TAB_PANEL } from '../../../lib/class-names-connection-form'

interface SslPanelProps {
  fields: FormFields
  onBrowseFile: (field: SslPathField) => void
}

export function SslPanel({ fields, onBrowseFile }: SslPanelProps) {
  return (
    <div className={CONNECTION_TAB_PANEL} role="tabpanel" data-testid="connection-form-panel-ssl">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex shrink-0 items-center pt-0.5">
          <Checkbox
            id="ssl-enabled"
            checked={fields.formData.sslEnabled}
            onChange={(event) => fields.updateField('sslEnabled', event.target.checked)}
            aria-label="Use SSL / TLS"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-headline text-size-body font-semibold text-light-on-surface dark:text-dark-on-surface">
            Use SSL / TLS
          </span>
          <span className="font-body text-size-caption leading-snug font-semibold text-light-on-surface-variant dark:text-dark-on-surface-variant">
            Required for AWS RDS and many managed clusters.
          </span>
        </div>
      </div>

      <div
        className="flex flex-col gap-3 border-t border-light-stroke-divider pt-4 dark:border-dark-stroke-divider"
        data-testid="ssl-certificate-section"
      >
        <SslFileField
          id="ssl-ca"
          label="CA certificate"
          value={fields.formData.sslCaPath ?? ''}
          onChange={(value) => fields.updateField('sslCaPath', value || null)}
          onBrowse={() => onBrowseFile('sslCaPath')}
          disabled={!fields.formData.sslEnabled}
          browseLabel="Browse CA certificate"
          placeholder="/path/to/ca.pem"
        />
        <SslFileField
          id="ssl-cert"
          label="Client certificate"
          value={fields.formData.sslCertPath ?? ''}
          onChange={(value) => fields.updateField('sslCertPath', value || null)}
          onBrowse={() => onBrowseFile('sslCertPath')}
          disabled={!fields.formData.sslEnabled}
          browseLabel="Browse client certificate"
          placeholder="/path/to/client-cert.pem"
        />
        <SslFileField
          id="ssl-key"
          label="Client key"
          value={fields.formData.sslKeyPath ?? ''}
          onChange={(value) => fields.updateField('sslKeyPath', value || null)}
          onBrowse={() => onBrowseFile('sslKeyPath')}
          disabled={!fields.formData.sslEnabled}
          browseLabel="Browse client key"
          placeholder="/path/to/client-key.pem"
        />
      </div>
    </div>
  )
}
