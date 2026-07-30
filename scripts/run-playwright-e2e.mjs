import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env, NODE_NO_WARNINGS: '1' }
delete env.NO_COLOR
const extraArgs = process.argv.slice(2).filter((a) => a !== '--')

const build = spawnSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'error'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...env, VITE_PLAYWRIGHT: 'true' },
})

if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

const result = spawnSync('pnpm', ['exec', 'playwright', 'test', ...extraArgs], {
  cwd: root,
  stdio: 'inherit',
  env,
})

process.exit(result.status ?? 1)
