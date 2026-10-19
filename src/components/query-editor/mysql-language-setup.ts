/**
 * MySQL language setup for Monaco.
 *
 * Module-level side effect: calls setupLanguageFeatures() with our custom
 * completionService so that monaco-sql-languages routes completions through
 * our schema-aware implementation.
 *
 * Import this module for the side effect:
 *   import './mysql-language-setup';
 */

import { setupLanguageFeatures, LanguageIdEnum } from 'monaco-sql-languages'
import { language as mysqlLanguage } from 'monaco-sql-languages/esm/languages/mysql/mysql'
import { completionService } from './completion-service'

/**
 * Gives `*` its own `operator.star.sql` token so the theme can colour it like a keyword while
 * `=`, `<` and other operator symbols stay plain code text, as in the Fluent proposal's editor
 * (`src/lib/monaco-theme.ts`). The library compiles this Monarch definition lazily, the first time
 * a `mysql` model is created, so the rule has to be in place before any editor mounts. It goes
 * just before the generic operator-symbol rule, after the comment rules that own `/*` and `*\/`.
 */
export const STAR_OPERATOR_RULE: [RegExp, string] = [/\*/, 'operator.star']

const rootRules = mysqlLanguage.tokenizer.root
if (!rootRules.includes(STAR_OPERATOR_RULE)) {
  rootRules.splice(rootRules.length - 1, 0, STAR_OPERATOR_RULE)
}

setupLanguageFeatures(LanguageIdEnum.MYSQL, {
  completionItems: {
    completionService,
    triggerCharacters: [' ', '.', '('],
  },
  diagnostics: true,
})
