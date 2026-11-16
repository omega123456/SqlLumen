import { languages } from 'monaco-editor'
import { registerLanguage } from 'monaco-sql-languages/esm/_.contribution.js'
import { LanguageIdEnum } from 'monaco-sql-languages/esm/common/constants.js'
import { CompletionAdapter, DiagnosticsAdapter } from 'monaco-sql-languages/esm/languageFeatures.js'
import {
  conf as mysqlConfiguration,
  language as mysqlLanguage,
} from 'monaco-sql-languages/esm/languages/mysql/mysql.js'
import { mysqlSnippets } from 'monaco-sql-languages/esm/languages/mysql/mysql.snippet.js'
import {
  LanguageServiceDefaultsImpl,
  modeConfigurationDefault,
} from 'monaco-sql-languages/esm/monaco.contribution.js'
import { WorkerManager } from 'monaco-sql-languages/esm/workerManager.js'
import type { Uri } from 'monaco-editor'
import type { EditorMySQLWorker } from '../../workers/editor-mysql-worker'
import { completionService } from './completion-service'
import { SchemaProblemReporter } from './semantic-highlighting/schema-problem-reporter'
import { MySqlSemanticTokensProvider } from './semantic-highlighting/semantic-tokens-provider'

export const STAR_OPERATOR_RULE: [RegExp, string] = [/\*/, 'operator.star']

const MYSQL_TRIGGER_CHARACTERS = [' ', '.', '(']

const rootRules = mysqlLanguage.tokenizer.root
if (!rootRules.includes(STAR_OPERATOR_RULE)) {
  rootRules.splice(rootRules.length - 1, 0, STAR_OPERATOR_RULE)
}

function createMySqlLanguageDefaults(): LanguageServiceDefaultsImpl {
  return new LanguageServiceDefaultsImpl(LanguageIdEnum.MYSQL, {
    ...modeConfigurationDefault,
    completionItems: {
      ...modeConfigurationDefault.completionItems,
      completionService: completionService,
      triggerCharacters: MYSQL_TRIGGER_CHARACTERS,
      snippets: mysqlSnippets,
    },
    diagnostics: true,
  })
}

export function setupMySqlLanguageMode(): void {
  const defaults = createMySqlLanguageDefaults()
  const workerManager = new WorkerManager<EditorMySQLWorker>(defaults)
  const worker = (...uris: Uri[]) => workerManager.getLanguageServiceWorker(...uris)
  new DiagnosticsAdapter(LanguageIdEnum.MYSQL, worker, defaults)
  languages.registerCompletionItemProvider(
    LanguageIdEnum.MYSQL,
    new CompletionAdapter(worker, defaults)
  )
  languages.registerDocumentSemanticTokensProvider(
    LanguageIdEnum.MYSQL,
    new MySqlSemanticTokensProvider(worker, new SchemaProblemReporter())
  )
}

const mysqlLanguageDefinition = {
  id: LanguageIdEnum.MYSQL,
  extensions: ['.mysql'],
  aliases: ['MySQL', 'mysql'],
  loader: async () => ({ conf: mysqlConfiguration, language: mysqlLanguage }),
}

registerLanguage(mysqlLanguageDefinition)

languages.onLanguage(LanguageIdEnum.MYSQL, setupMySqlLanguageMode)
