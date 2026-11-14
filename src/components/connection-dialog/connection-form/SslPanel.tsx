import { Checkbox } from '../../common/Checkbox'
import type { SslPathField } from '../connection-editor-state'
import { SslFileField, type FormFields } from './form-fields'
import styles from '../ConnectionForm.module.css'

interface SslPanelProps {
  fields: FormFields
  onBrowseFile: (field: SslPathField) => void
}

export function SslPanel({ fields, onBrowseFile }: SslPanelProps) {
  return (
    <div className={styles.tabPanel} role="tabpanel" data-testid="connection-form-panel-ssl">
      <div className={styles.sslBlock}>
        <div className={styles.sslCheckboxWrap}>
          <Checkbox
            id="ssl-enabled"
            checked={fields.formData.sslEnabled}
            onChange={(event) => fields.updateField('sslEnabled', event.target.checked)}
            aria-label="Use SSL / TLS"
          />
        </div>
        <div className={styles.sslCopy}>
          <span className={styles.sslTitle}>Use SSL / TLS</span>
          <span className={styles.sslHint}>Required for AWS RDS and many managed clusters.</span>
        </div>
      </div>

      <div className={styles.sslFiles} data-testid="ssl-certificate-section">
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
