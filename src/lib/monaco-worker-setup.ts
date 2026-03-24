/**
 * Monaco Editor worker environment setup.
 * Must be imported ONCE before any Monaco editor is mounted.
 * Uses Vite native worker imports for offline Tauri bundling.
 */

import EditorWorkerUrl from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorkerUrl from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorkerUrl from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorkerUrl from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorkerUrl from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
// Custom single-step MySQL worker — see src/workers/mysql-language.worker.ts
import MySQLLanguageWorker from '../workers/mysql-language.worker?worker'

// Monaco global — self.MonacoEnvironment configures worker instantiation
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new JsonWorkerUrl()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorkerUrl()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorkerUrl()
    if (label === 'typescript' || label === 'javascript') return new TsWorkerUrl()
    if (label === 'mysql') return new MySQLLanguageWorker()
    return new EditorWorkerUrl()
  },
}
