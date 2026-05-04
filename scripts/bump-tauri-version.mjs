import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as readline from 'node:readline/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const tauriConfPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json')
const cargoTomlPath = path.join(repoRoot, 'src-tauri', 'Cargo.toml')
const tauriDir = path.join(repoRoot, 'src-tauri')
const releaseBodyRelative = '.github/tauri-release-body.md'
const releaseBodyPath = path.join(repoRoot, releaseBodyRelative)

/** Keep in sync with `.github/tauri-release-body.md` and the workflow fallback string. */
const DEFAULT_RELEASE_BODY =
  'See the release assets to download installers for Windows and macOS.'

function parseSemver(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(s).trim())
  if (!m) {
    return null
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

function versionToGitTag(version) {
  return `v${version}`
}

/** @returns {string | null} */
function getCargoPackageVersion(cargoTomlText) {
  const lines = cargoTomlText.split(/\r?\n/)
  let inPackage = false
  for (const line of lines) {
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (sec) {
      inPackage = sec[1].trim() === 'package'
      continue
    }
    if (inPackage) {
      const m = /^\s*version\s*=\s*"([^"]*)"/.exec(line)
      if (m) {
        return m[1]
      }
    }
  }
  return null
}

/** @returns {string} */
function setCargoPackageVersion(cargoTomlText, newVersion) {
  const lines = cargoTomlText.split(/\r?\n/)
  const eol = cargoTomlText.includes('\r\n') ? '\r\n' : '\n'
  let inPackage = false
  let replaced = false
  const out = []
  for (const line of lines) {
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (sec) {
      inPackage = sec[1].trim() === 'package'
      out.push(line)
      continue
    }
    if (inPackage && /^\s*version\s*=\s*"/.test(line)) {
      out.push(line.replace(/^(\s*version\s*=\s*")[^"]*(".*)$/, `$1${newVersion}$2`))
      replaced = true
      continue
    }
    out.push(line)
  }
  if (!replaced) {
    throw new Error(`Could not find [package] version = "..." in ${cargoTomlPath}`)
  }
  return out.join(eol)
}

function bumpSemver(current, kind) {
  const v = parseSemver(current)
  if (!v) {
    return null
  }
  if (kind === 'major') {
    return `${v.major + 1}.0.0`
  }
  if (kind === 'minor') {
    return `${v.major}.${v.minor + 1}.0`
  }
  if (kind === 'patch') {
    return `${v.major}.${v.minor}.${v.patch + 1}`
  }
  return null
}

function gitTagExists(tag) {
  try {
    execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function runGit(args, inheritIo = true) {
  execFileSync('git', args, {
    cwd: repoRoot,
    stdio: inheritIo ? 'inherit' : 'pipe',
    encoding: 'utf8',
  })
}

/** Runs `cargo generate-lockfile` so `Cargo.lock` matches the bumped `[package] version`. */
function runCargoGenerateLockfile() {
  execFileSync('cargo', ['generate-lockfile'], {
    cwd: tauriDir,
    stdio: 'inherit',
  })
}

/** Runs `pnpm build` (tsc + vite). Throws if the build fails. */
function runProductionBuild() {
  execSync('pnpm build', {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  })
}

function restoreVersionFilesAndReleaseBody(
  tauriConfRaw,
  cargoTomlRaw,
  releaseBodyExisted,
  releaseBodyRaw
) {
  writeFileSync(tauriConfPath, tauriConfRaw, 'utf8')
  writeFileSync(cargoTomlPath, cargoTomlRaw, 'utf8')
  if (releaseBodyExisted && releaseBodyRaw !== null) {
    writeFileSync(releaseBodyPath, releaseBodyRaw, 'utf8')
  } else {
    try {
      unlinkSync(releaseBodyPath)
    } catch {
      /* file may not exist */
    }
  }
  try {
    runGit(['restore', 'src-tauri/Cargo.lock'], false)
  } catch {
    /* lockfile may be untracked or restore unsupported; best-effort */
  }
}

/** @param {import('node:readline').Interface} rl */
async function readReleaseNotes(rl) {
  console.log('')
  console.log('Release notes for the GitHub release (shown on the Releases page).')
  console.log('  Press Enter once to use the default message, or')
  console.log('  type one or more lines and finish with an empty line.')
  console.log('')
  console.log(`Default:\n  ${DEFAULT_RELEASE_BODY}\n`)

  const lines = []
  while (true) {
    const prompt = lines.length === 0 ? 'Notes (Enter = default): ' : 'Notes (empty line ends): '
    const line = await rl.question(prompt)
    if (lines.length === 0 && line.trim() === '') {
      return DEFAULT_RELEASE_BODY
    }
    if (lines.length > 0 && line === '') {
      return lines.join('\n')
    }
    lines.push(line)
  }
}

async function main() {
  const raw = readFileSync(tauriConfPath, 'utf8')
  const conf = JSON.parse(raw)
  const current = conf.version
  if (typeof current !== 'string' || !current) {
    console.error(`[bump-tauri-version] Missing string "version" in ${tauriConfPath}`)
    process.exit(1)
  }
  if (!parseSemver(current)) {
    console.error(
      `[bump-tauri-version] Current version "${current}" is not MAJOR.MINOR.PATCH; fix it manually first.`
    )
    process.exit(1)
  }

  let cargoRaw
  try {
    cargoRaw = readFileSync(cargoTomlPath, 'utf8')
  } catch {
    console.error(`[bump-tauri-version] Could not read ${cargoTomlPath}`)
    process.exit(1)
  }
  const cargoPkgVersion = getCargoPackageVersion(cargoRaw)
  if (!cargoPkgVersion) {
    console.error(
      `[bump-tauri-version] Missing [package] version = "..." in ${path.relative(repoRoot, cargoTomlPath)}`
    )
    process.exit(1)
  }
  if (cargoPkgVersion !== current) {
    console.warn(
      `[bump-tauri-version] Note: Cargo.toml [package] version is "${cargoPkgVersion}" but tauri.conf.json is "${current}". Both will be set to the new version.`
    )
  }

  let releaseBodyPreviousRaw = null
  let releaseBodyPreviousExisted = false
  try {
    releaseBodyPreviousRaw = readFileSync(releaseBodyPath, 'utf8')
    releaseBodyPreviousExisted = true
  } catch {
    releaseBodyPreviousRaw = null
    releaseBodyPreviousExisted = false
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    console.log(`Current version in src-tauri/tauri.conf.json: ${current}`)
    console.log(`Current [package] version in src-tauri/Cargo.toml: ${cargoPkgVersion}`)
    console.log('')
    console.log('How much to bump?')
    console.log('  1 = major (X.0.0)')
    console.log('  2 = minor (0.X.0)')
    console.log('  3 = patch (0.0.X)')
    console.log('  4 = set a specific version (semver: MAJOR.MINOR.PATCH)')
    console.log('')

    const choice = (await rl.question('Choice [1-4]: ')).trim()
    let next = null
    if (choice === '1') {
      next = bumpSemver(current, 'major')
    } else if (choice === '2') {
      next = bumpSemver(current, 'minor')
    } else if (choice === '3') {
      next = bumpSemver(current, 'patch')
    } else if (choice === '4') {
      const entered = (await rl.question('New version (MAJOR.MINOR.PATCH): ')).trim()
      next = parseSemver(entered) ? entered : null
    } else {
      console.error('[bump-tauri-version] Enter 1, 2, 3, or 4.')
      process.exit(1)
    }

    if (!next) {
      console.error('[bump-tauri-version] Could not compute a valid semver (MAJOR.MINOR.PATCH).')
      process.exit(1)
    }

    if (next === current) {
      console.error(`[bump-tauri-version] New version equals current (${current}); nothing to do.`)
      process.exit(1)
    }

    const gitTag = versionToGitTag(next)
    if (gitTagExists(gitTag)) {
      console.error(`[bump-tauri-version] Git tag "${gitTag}" already exists.`)
      process.exit(1)
    }

    const releaseNotes = await readReleaseNotes(rl)

    conf.version = next
    const cargoUpdated = setCargoPackageVersion(cargoRaw, next)
    writeFileSync(tauriConfPath, `${JSON.stringify(conf, null, 2)}\n`, 'utf8')
    writeFileSync(cargoTomlPath, cargoUpdated, 'utf8')
    writeFileSync(releaseBodyPath, `${releaseNotes}\n`, 'utf8')
    console.log('')
    console.log(`Updated ${path.relative(repoRoot, tauriConfPath)} to ${next}.`)
    console.log(`Updated ${path.relative(repoRoot, cargoTomlPath)} [package] version to ${next}.`)
    console.log(`Updated ${releaseBodyRelative} for GitHub Actions release body.`)

    console.log('')
    console.log('Refreshing src-tauri/Cargo.lock (cargo generate-lockfile)…')
    try {
      runCargoGenerateLockfile()
    } catch {
      restoreVersionFilesAndReleaseBody(
        raw,
        cargoRaw,
        releaseBodyPreviousExisted,
        releaseBodyPreviousRaw
      )
      console.error(
        '[bump-tauri-version] cargo generate-lockfile failed; restored previous tauri.conf.json, Cargo.toml, release body, and Cargo.lock. No commit, tag, or push.'
      )
      process.exit(1)
    }

    console.log('')
    console.log('Running pnpm build (tsc + vite build) before commit/tag…')
    try {
      runProductionBuild()
    } catch {
      restoreVersionFilesAndReleaseBody(
        raw,
        cargoRaw,
        releaseBodyPreviousExisted,
        releaseBodyPreviousRaw
      )
      console.error(
        '[bump-tauri-version] Build failed; restored previous tauri.conf.json, Cargo.toml, release body, and Cargo.lock. No commit, tag, or push.'
      )
      process.exit(1)
    }

    runGit([
      'add',
      'src-tauri/tauri.conf.json',
      'src-tauri/Cargo.toml',
      'src-tauri/Cargo.lock',
      releaseBodyRelative,
    ])
    runGit(['commit', '-m', `chore: bump version to ${next}`])
    runGit(['tag', gitTag])
    console.log(`Created tag ${gitTag}.`)

    runGit(['push'])
    runGit(['push', 'origin', gitTag])
    console.log('Pushed branch and tag.')
  } finally {
    rl.close()
  }
}

main().catch((err) => {
  console.error('[bump-tauri-version]', err)
  process.exit(1)
})
