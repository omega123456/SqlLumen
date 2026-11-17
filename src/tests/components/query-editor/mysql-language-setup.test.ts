import { describe, expect, it, vi } from 'vitest'
import { languages } from 'monaco-editor'
import type { Uri } from 'monaco-editor'
import { registerLanguage } from 'monaco-sql-languages/esm/_.contribution.js'
import { CompletionAdapter, DiagnosticsAdapter } from 'monaco-sql-languages/esm/languageFeatures.js'
import { conf, language } from 'monaco-sql-languages/esm/languages/mysql/mysql.js'
import { LanguageServiceDefaultsImpl } from 'monaco-sql-languages/esm/monaco.contribution.js'
import { WorkerManager } from 'monaco-sql-languages/esm/workerManager.js'
import {
  setupMySqlLanguageMode,
  STAR_OPERATOR_RULE,
} from '../../../components/query-editor/mysql-language-setup'
import { MySqlSemanticTokensProvider } from '../../../components/query-editor/semantic-highlighting/semantic-tokens-provider'

describe('mysql language setup — star operator token', () => {
  it('adds the `*` rule once, just before the generic operator-symbol rule', () => {
    const root = language.tokenizer.root
    expect(root.filter((rule: unknown) => rule === STAR_OPERATOR_RULE)).toHaveLength(1)
    expect(root.indexOf(STAR_OPERATOR_RULE)).toBe(root.length - 2)
    const [pattern, token] = STAR_OPERATOR_RULE
    expect(token).toBe('operator.star')
    expect(pattern.test('*')).toBe(true)
    expect(pattern.test('=')).toBe(false)
  })
})

function setUpFreshLanguageMode(): void {
  vi.mocked(LanguageServiceDefaultsImpl).mockClear()
  vi.mocked(WorkerManager).mockClear()
  vi.mocked(DiagnosticsAdapter).mockClear()
  vi.mocked(CompletionAdapter).mockClear()
  vi.mocked(languages.registerCompletionItemProvider).mockClear()
  vi.mocked(languages.registerDocumentSemanticTokensProvider).mockClear()
  setupMySqlLanguageMode()
}

describe('mysql language setup — language mode', () => {
  it('registers the mysql language with its Monarch tokenizer and configuration', async () => {
    const definition = vi.mocked(registerLanguage).mock.calls[0][0]

    expect(definition).toMatchObject({ id: 'mysql', extensions: ['.mysql'] })
    await expect(definition.loader()).resolves.toEqual({ conf: conf, language: language })
  })

  it('shares one worker between diagnostics, completion and semantic tokens', () => {
    setUpFreshLanguageMode()

    expect(WorkerManager).toHaveBeenCalledTimes(1)
    const workerManager = vi.mocked(WorkerManager).mock.instances[0]
    const worker = vi.mocked(DiagnosticsAdapter).mock.calls[0][1]
    const uri = { toString: () => 'inmemory://model/1' } as unknown as Uri
    void worker(uri)
    expect(workerManager.getLanguageServiceWorker).toHaveBeenCalledWith(uri)
    expect(vi.mocked(CompletionAdapter).mock.calls[0][0]).toBe(worker)
    expect(languages.registerCompletionItemProvider).toHaveBeenCalledWith(
      'mysql',
      vi.mocked(CompletionAdapter).mock.instances[0]
    )
    const semanticTokensRegistration = vi.mocked(languages.registerDocumentSemanticTokensProvider)
      .mock.calls[0]
    expect(semanticTokensRegistration[0]).toBe('mysql')
    expect(semanticTokensRegistration[1]).toBeInstanceOf(MySqlSemanticTokensProvider)
  })
})
