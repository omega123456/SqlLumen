import { Button } from '../../common/Button'
import type { ConnectionUrlFields } from '../../../lib/mysql-connection-url'

interface UrlReviewProps {
  fields: ConnectionUrlFields
  ignoredOptions: string[]
  isSaving: boolean
  onSaveAndConnect: () => void
  onReviewAll: () => void
  onCancel: () => void
}

type FactTone = 'mono' | 'text'

interface ReviewFact {
  label: string
  value: string
  tone: FactTone
}

const FACT_VALUE_CLASSES: Record<FactTone, string> = {
  mono: 'font-mono text-mono text-light-on-surface dark:text-dark-on-surface',
  text: 'text-body text-light-on-surface dark:text-dark-on-surface',
}

const NOT_SET = 'Not set'

function passwordFact(password: string): string {
  return password === '' ? 'Not in URL' : 'From URL, saved encrypted'
}

function reviewFacts(fields: ConnectionUrlFields): ReviewFact[] {
  return [
    { label: 'Host', value: fields.host, tone: 'mono' },
    { label: 'Port', value: String(fields.port), tone: 'mono' },
    { label: 'User', value: fields.username || NOT_SET, tone: 'mono' },
    { label: 'Database', value: fields.database ?? NOT_SET, tone: 'mono' },
    { label: 'Password', value: passwordFact(fields.password), tone: 'text' },
  ]
}

function IgnoredOptions({ options }: { options: string[] }) {
  if (options.length === 0) return null
  return (
    <span className="text-row text-light-on-surface-variant dark:text-dark-on-surface-variant">
      Not used: <span className="font-mono text-mono">{options.join(', ')}</span>
    </span>
  )
}

export function UrlReview(props: UrlReviewProps) {
  return (
    <div
      className="mt-2 flex flex-col gap-4 border-l-2 border-light-primary py-1 pl-5 dark:border-dark-primary"
      data-testid="url-review"
    >
      <h2 className="text-body font-semibold text-light-on-surface dark:text-dark-on-surface">
        New connection from URL
      </h2>
      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        {reviewFacts(props.fields).map((fact) => (
          <div key={fact.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-row text-light-on-surface-variant dark:text-dark-on-surface-variant">
              {fact.label}
            </dt>
            <dd className={FACT_VALUE_CLASSES[fact.tone]}>{fact.value}</dd>
          </div>
        ))}
      </dl>
      <IgnoredOptions options={props.ignoredOptions} />
      <div className="flex items-center gap-2">
        <Button variant="accent" onClick={props.onSaveAndConnect} disabled={props.isSaving}>
          Save and connect
        </Button>
        <Button onClick={props.onReviewAll}>Review all settings</Button>
        <Button variant="subtle" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
