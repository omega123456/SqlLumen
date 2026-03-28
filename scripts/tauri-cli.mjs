import { spawn } from 'node:child_process'
import { runTauriDev } from './tauri-dev.mjs'

const args = process.argv.slice(2)

if (args[0] === 'dev') {
  runTauriDev(args.slice(1))
    .then((code) => {
      process.exit(code)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
} else {
  const child = spawn('pnpm', ['exec', 'tauri', ...args], {
    stdio: 'inherit',
    shell: true,
    cwd: process.cwd(),
  })
  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(1)
    } else {
      process.exit(code ?? 0)
    }
  })
}
