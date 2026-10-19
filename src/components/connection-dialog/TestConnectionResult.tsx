import type { TestConnectionResult as TestConnectionResultType } from '../../types/connection'
import { InfoBar } from '../common/InfoBar'

interface TestConnectionResultProps {
  result: TestConnectionResultType | null
}

export function TestConnectionResult({ result }: TestConnectionResultProps) {
  if (!result) return null

  if (result.success) {
    return (
      <InfoBar
        severity="success"
        title="Connected"
        message={`${result.serverVersion} in ${result.connectionTimeMs} ms`}
        detail={`Auth method ${result.authMethod} · SSL ${result.sslStatus}`}
        data-testid="test-connection-result"
      />
    )
  }

  return (
    <InfoBar
      severity="error"
      title="Connection failed"
      message={result.errorMessage}
      data-testid="test-connection-result"
    />
  )
}
