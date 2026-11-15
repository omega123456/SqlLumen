import { TextInput } from '../../common/TextInput'
import { FormField, PasswordField, type FormFields, type PasswordControls } from './form-fields'
import { CONNECTION_TAB_PANEL } from '../../../lib/class-names-connection-form'

const DECIMAL_RADIX = 10
const MIN_PORT = 1
const MAX_PORT = 65535

interface GeneralPanelProps {
  fields: FormFields
  nameAutoFocus: boolean
  password: PasswordControls
}

function HostPortRow({ fields }: { fields: FormFields }) {
  return (
    <div className="grid grid-cols-connection-row items-start gap-x-3 gap-y-3.5">
      <FormField id="conn-host" label="Host address" error={fields.errors.host}>
        <TextInput
          id="conn-host"
          type="text"
          variant="mono"
          invalid={!!fields.errors.host}
          value={fields.formData.host}
          onChange={(event) => fields.updateField('host', event.target.value)}
          placeholder="localhost"
        />
      </FormField>
      <FormField id="conn-port" label="Port" error={fields.errors.port}>
        <TextInput
          id="conn-port"
          type="number"
          variant="mono"
          invalid={!!fields.errors.port}
          value={fields.formData.port}
          onChange={(event) =>
            fields.updateField('port', parseInt(event.target.value, DECIMAL_RADIX) || 0)
          }
          min={MIN_PORT}
          max={MAX_PORT}
          placeholder="3306"
        />
      </FormField>
    </div>
  )
}

function UserPasswordRow({ fields, password }: Omit<GeneralPanelProps, 'nameAutoFocus'>) {
  return (
    <div className="grid grid-cols-connection-row items-start gap-x-3 gap-y-3.5 max-compact:grid-cols-1">
      <FormField id="conn-username" label="Username" error={fields.errors.username}>
        <TextInput
          id="conn-username"
          type="text"
          variant="mono"
          invalid={!!fields.errors.username}
          value={fields.formData.username}
          onChange={(event) => fields.updateField('username', event.target.value)}
          placeholder="root"
        />
      </FormField>
      <PasswordField value={fields.formData.password} password={password} />
    </div>
  )
}

export function GeneralPanel({ fields, nameAutoFocus, password }: GeneralPanelProps) {
  return (
    <div
      className={CONNECTION_TAB_PANEL}
      role="tabpanel"
      data-testid="connection-form-panel-general"
    >
      <FormField id="conn-name" label="Connection name" error={fields.errors.name}>
        <TextInput
          id="conn-name"
          type="text"
          invalid={!!fields.errors.name}
          value={fields.formData.name}
          onChange={(event) => fields.updateField('name', event.target.value)}
          placeholder="My production server"
          autoFocus={nameAutoFocus}
        />
      </FormField>

      <HostPortRow fields={fields} />
      <UserPasswordRow fields={fields} password={password} />

      <FormField id="conn-database" label="Default database">
        <TextInput
          id="conn-database"
          type="text"
          variant="mono"
          value={fields.formData.defaultDatabase ?? ''}
          onChange={(event) => fields.updateField('defaultDatabase', event.target.value || null)}
          placeholder="mydb"
        />
      </FormField>
    </div>
  )
}
