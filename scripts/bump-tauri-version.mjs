import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as readline from 'node:readline/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const tauriConfPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json')

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

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  try {
    console.log(`Current version in src-tauri/tauri.conf.json: ${current}`)
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

    conf.version = next
    writeFileSync(tauriConfPath, `${JSON.stringify(conf, null, 2)}\n`, 'utf8')
    console.log('')
    console.log(`Updated ${path.relative(repoRoot, tauriConfPath)} to ${next}.`)

    runGit(['add', 'src-tauri/tauri.conf.json'])
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
