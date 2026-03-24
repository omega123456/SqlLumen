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
import { completionService } from './completion-service'

setupLanguageFeatures(LanguageIdEnum.MYSQL, {
  completionItems: {
    completionService,
    triggerCharacters: [' ', '.', '('],
  },
  diagnostics: true,
})
