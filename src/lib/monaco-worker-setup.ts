import EditorWorkerUrl from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorkerUrl from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorkerUrl from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorkerUrl from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorkerUrl from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import MySQLLanguageWorker from '../workers/mysql-language.worker?worker'

type WorkerConstructor = new () => Worker

const WORKER_BY_LANGUAGE_LABEL: Partial<Record<string, WorkerConstructor>> = {
  json: JsonWorkerUrl,
  css: CssWorkerUrl,
  scss: CssWorkerUrl,
  less: CssWorkerUrl,
  html: HtmlWorkerUrl,
  handlebars: HtmlWorkerUrl,
  razor: HtmlWorkerUrl,
  typescript: TsWorkerUrl,
  javascript: TsWorkerUrl,
  mysql: MySQLLanguageWorker,
}

function workerForLanguageLabel(label: string): WorkerConstructor {
  return WORKER_BY_LANGUAGE_LABEL[label] ?? EditorWorkerUrl
}

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    const WorkerForLabel = workerForLanguageLabel(label)
    return new WorkerForLabel()
  },
}
