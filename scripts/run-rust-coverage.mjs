import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

function readCommand(command, args) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function tryReadCommand(command, args) {
  try {
    return readCommand(command, args)
  } catch {
    return null
  }
}

function ensureRustCoverageTools(env) {
  if (env.LLVM_COV && env.LLVM_PROFDATA) {
    return env
  }

  const rustupHome =
    env.RUSTUP_HOME ?? tryReadCommand('rustup', ['show', 'home']) ?? path.join(env.HOME ?? '', '.rustup')
  const activeToolchainOutput = tryReadCommand('rustup', ['show', 'active-toolchain'])
  const hostLine = tryReadCommand('rustc', ['-vV'])
    ?.split('\n')
    .find((line) => line.startsWith('host: '))
  const host = hostLine?.replace('host: ', '').trim()
  const toolchain = activeToolchainOutput?.split(/\s+/)[0]

  if (!rustupHome || !toolchain || !host) {
    return env
  }

  const llvmBinDir = path.join(rustupHome, 'toolchains', toolchain, 'lib', 'rustlib', host, 'bin')
  const llvmCov = path.join(llvmBinDir, 'llvm-cov')
  const llvmProfdata = path.join(llvmBinDir, 'llvm-profdata')

  if (!existsSync(llvmCov) || !existsSync(llvmProfdata)) {
    return env
  }

  return {
    ...env,
    LLVM_COV: env.LLVM_COV ?? llvmCov,
    LLVM_PROFDATA: env.LLVM_PROFDATA ?? llvmProfdata,
  }
}

const env = ensureRustCoverageTools({ ...process.env })

// Use `rustup run stable cargo` to ensure the rustup-managed rustc is used,
// so cargo-llvm-cov resolves llvm-profdata via the correct sysroot regardless
// of which `cargo` binary PATH resolves to (e.g. Homebrew vs rustup shim).
const hasRustup = Boolean(tryReadCommand('rustup', ['--version']))
const [command, commandArgs] = hasRustup
  ? ['rustup', ['run', 'stable', 'cargo', 'sqllumen-llvm-cov']]
  : ['cargo', ['sqllumen-llvm-cov']]

const child = spawn(command, commandArgs, {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1)
  } else {
    process.exit(code ?? 0)
  }
})
