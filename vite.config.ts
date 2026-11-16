import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const MONACO_PRE_0_57_DEEP_IMPORT = /^monaco-editor\/esm\/vs\//
const MONACO_PUBLIC_SUBPATH = 'monaco-editor/'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // monaco-sql-languages 1.3.1 still imports monaco-editor/esm/vs/*, which Monaco 0.57's exports map no longer serves
      { find: MONACO_PRE_0_57_DEEP_IMPORT, replacement: MONACO_PUBLIC_SUBPATH },
    ],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: false,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: [
      'monaco-editor/editor/editor.worker',
      '@tauri-apps/api/core',
      '@tauri-apps/api/mocks',
    ],
  },
})
