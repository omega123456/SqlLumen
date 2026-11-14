import { setupLanguageFeatures, LanguageIdEnum } from 'monaco-sql-languages'
import { language as mysqlLanguage } from 'monaco-sql-languages/esm/languages/mysql/mysql.js'
import { completionService } from './completion-service'

export const STAR_OPERATOR_RULE: [RegExp, string] = [/\*/, 'operator.star']

const rootRules = mysqlLanguage.tokenizer.root
if (!rootRules.includes(STAR_OPERATOR_RULE)) {
  rootRules.splice(rootRules.length - 1, 0, STAR_OPERATOR_RULE)
}

setupLanguageFeatures(LanguageIdEnum.MYSQL, {
  completionItems: {
    completionService: completionService,
    triggerCharacters: [' ', '.', '('],
  },
  diagnostics: true,
})
