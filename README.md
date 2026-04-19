# SqlLumen

A cross-platform **desktop MySQL / MariaDB client** built with [Tauri](https://tauri.app/) 2 and [React](https://react.dev/) 19 (TypeScript). The UI is a native shell—sidebar object browser, tabbed workspace, resizable panels, and status bar—with light/dark theming. **MySQL and MariaDB** access runs in the Rust backend; the frontend talks to the database only through Tauri IPC (`invoke`), with local **SQLite** for app settings, history, and other persisted data.

## Features

- **Connections** — save and open connections; test connectivity from the connection dialog
- **Object browser** — navigate databases, tables, views, and related objects
- **Query editor** — Monaco-based SQL editing with formatting and completion-oriented tooling
- **Result sets** — grid, form, and text views; execution feedback and toolbars
- **Table data** — browse and edit rows with validation and related UI (foreign keys, unsaved changes)
- **Table designer** — column, index, and foreign-key editing with DDL preview and apply flow
- **Schema information** — columns, indexes, foreign keys, DDL, and stats-style panels where supported
- **Import / export** — data and SQL-oriented workflows (e.g. CSV, JSON, XLSX, SQL dump paths—see in-app dialogs)
- **History & favorites** — query history and saved snippets/favorites
- **Settings** — general, editor, and results preferences; theme (light / dark / system) persisted locally
- **AI Assistant** — in-app assistant workflows for SQL tasks and product guidance
- **Native desktop app** — smaller footprint than typical Electron stacks; bundles via Tauri

> **Upgrade note:** Upgrading to this version triggers a one-time v2 schema index rebuild. The first AI-assisted query after upgrading will take slightly longer while the index is rebuilt with enriched metadata (row counts, table/column comments, FK edge graph).

## Stack

| Layer         | Technologies                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Desktop shell | Tauri 2, Rust (async MySQL pool, migrations, export writers)                                                |
| UI            | React 19, TypeScript, Vite 8, Zustand, `react-resizable-panels`, Monaco                                     |
| Data grid     | `react-data-grid` (via a shared app wrapper)                                                                |
| Tests         | Vitest (coverage gates), Rust integration tests (nextest / llvm-cov), Playwright E2E + screenshot baselines |

## Requirements

| Tool                                                   | Notes                                                                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [Node.js](https://nodejs.org/)                         | LTS recommended                                                                                                               |
| [pnpm](https://pnpm.io/)                               | Package manager (`corepack enable` or install globally)                                                                       |
| [Rust](https://www.rust-lang.org/tools/install)        | Required to build the Tauri backend (`cargo`, `rustc`)                                                                        |
| [cargo-nextest](https://nexte.st/book/installing.html) | For `pnpm test:rust`, `pnpm test:rust:coverage`, and `pnpm test:all`: `cargo install cargo-nextest`                           |
| Rust coverage (optional)                               | For `pnpm test:rust:coverage` / `pnpm test:all`: `cargo install cargo-llvm-cov` and `rustup component add llvm-tools-preview` |
| OS deps                                                | See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform                                        |

## Setup

Follow these steps on a new machine before **Quick start** or **Contributing**.

1. **Node.js** — Install [Node.js](https://nodejs.org/) (LTS). Verify with `node -v`.
2. **pnpm** — Enable via Corepack (`corepack enable` then `corepack prepare pnpm@latest --activate`) or [install pnpm](https://pnpm.io/installation) globally. Verify with `pnpm -v`.
3. **Rust** — Install [rustup](https://www.rust-lang.org/tools/install) and the stable toolchain. Verify with `cargo -v` and `rustc -V`.
4. **Tauri OS dependencies** — Install the tools Tauri needs on your OS (compilers, WebView2 on Windows, etc.): [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
5. **Clone and install JS deps** — From the repo root:
   ```bash
   git clone <repository-url>
   cd <your-clone-directory>
   pnpm install
   ```
6. **Playwright (for E2E / `pnpm test:all`)** — Install browsers once (this project uses Chromium):
   ```bash
   pnpm exec playwright install chromium
   ```
7. **cargo-nextest (for Rust integration tests)** — Not installed by `pnpm install`. The repo uses Nextest via Cargo aliases in `.cargo/config.toml` (`sqllumen-test-integration`, `sqllumen-llvm-cov`). From any directory:

   ```bash
   cargo install cargo-nextest
   ```

   Verify with `cargo nextest --version`. Ensure `~/.cargo/bin` (or your Cargo bin directory) is on your `PATH`.

8. **Rust coverage tools (for `pnpm test:rust:coverage` and `pnpm test:all`)** — Requires Nextest (step 7). From any directory:
   ```bash
   rustup component add llvm-tools-preview
   cargo install cargo-llvm-cov
   ```
   Ensure `cargo llvm-cov` is on your `PATH` (same Cargo bin directory as above).

For day-to-day development you only need steps 1–5 and **Quick start** below. Add steps 6–8 when you run the full Rust or end-to-end test suite.

## Quick start

From the repository root (after **[Setup](#setup)** if this is a fresh clone):

```bash
pnpm install
pnpm tauri dev
```

The dev server prefers port **1420**. `pnpm tauri dev` uses `http://127.0.0.1:1420` from Tauri config. `pnpm dev` (frontend-only) runs Vite on the same port when free—check Vite’s startup banner for the actual URL.

### Web-only UI (no native shell)

Useful for quick frontend iteration without the Rust toolchain (IPC must be mocked or features that call the backend will not work end-to-end):

```bash
pnpm dev
```

## Scripts

| Command                       | Purpose                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                    | Vite dev server                                                                                                                                                                                                                                                                                 |
| `pnpm build`                  | Typecheck + production frontend build                                                                                                                                                                                                                                                           |
| `pnpm preview`                | Preview the built frontend                                                                                                                                                                                                                                                                      |
| `pnpm tauri dev`              | Run the full Tauri app in development                                                                                                                                                                                                                                                           |
| `pnpm tauri build`            | Build installable bundles for your OS                                                                                                                                                                                                                                                           |
| `pnpm release:tauri-version`  | Interactive release helper: bumps `version` in `src-tauri/tauri.conf.json`, prompts for GitHub release notes (default: `.github/tauri-release-body.md` / same text as CI fallback), runs `pnpm build` (no commit, tag, or push if that fails), then commits, tags `v*`, and pushes branch + tag |
| `pnpm test`                   | Run Vitest once                                                                                                                                                                                                                                                                                 |
| `pnpm test:watch`             | Vitest in watch mode                                                                                                                                                                                                                                                                            |
| `pnpm test:coverage`          | Vitest with coverage thresholds                                                                                                                                                                                                                                                                 |
| `pnpm test:rust`              | Rust integration tests via [cargo-nextest](https://nexte.st/) (`cargo sqllumen-test-integration`; targets and flags in `.cargo/config.toml`)                                                                                                                                                    |
| `pnpm test:rust:coverage`     | Same tests under [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) (`cargo sqllumen-llvm-cov`; summary to stdout; artifacts under `src-tauri/target/`)                                                                                                                                |
| `pnpm test:all`               | Vitest coverage + Rust llvm-cov + Playwright E2E (run after substantive changes)                                                                                                                                                                                                                |
| `pnpm test:e2e`               | Playwright E2E tests                                                                                                                                                                                                                                                                            |
| `pnpm test:screenshots`       | Playwright visual regression (`e2e/screenshots.spec.ts`) only                                                                                                                                                                                                                                   |
| `pnpm lint` / `pnpm lint:fix` | ESLint                                                                                                                                                                                                                                                                                          |
| `pnpm format`                 | Prettier on `src/`                                                                                                                                                                                                                                                                              |
| `pnpm typecheck`              | `tsc --noEmit`                                                                                                                                                                                                                                                                                  |

## GitHub releases (CI)

The workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) builds **Windows** (x64) and **macOS** (Apple Silicon and Intel) bundles and uploads them to a **GitHub Release**. It runs on **`workflow_dispatch`** (Actions tab → Release → Run workflow) or when you push a version tag matching `v*` (e.g. `v0.1.0`).

1. From the repo root, run **`pnpm release:tauri-version`** (see [`scripts/bump-tauri-version.mjs`](scripts/bump-tauri-version.mjs)). It interactively bumps **`version`** in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json), asks for **release notes** (press Enter to keep the default message), writes them to [`.github/tauri-release-body.md`](.github/tauri-release-body.md) for the [release workflow](.github/workflows/release.yml), runs **`pnpm build`** first; if the build fails it restores `tauri.conf.json` and the release body file and does **not** commit, tag, or push. On success it commits, creates the `v*` tag, and pushes the branch and tag. Keep [`package.json`](package.json) / [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml) aligned with the shipped version if your process requires it—the script only edits `tauri.conf.json` and the release body file.
2. Or bump `tauri.conf.json` yourself, commit and push, then create and push the tag (e.g. `git tag v0.1.0 && git push origin v0.1.0`), or run the workflow manually after tagging.
3. If asset upload fails with a permissions error, set the repository’s **Settings → Actions → General → Workflow permissions** to **Read and write**.

Releases are created as **drafts** by default; publish them from the Releases page when ready. macOS artifacts from CI are **unsigned** unless you add Apple code signing secrets to the workflow—users may see Gatekeeper warnings until signing/notarization is configured ([Tauri macOS signing](https://v2.tauri.app/distribute/sign-macos/)).

## macOS quarantine exclusion (step by step)

If macOS blocks the app because it is unsigned (for example, "app is damaged" or "cannot be opened"), remove quarantine attributes from the app bundle.

1. Move the app to a stable location, such as `/Applications/SqlLumen.app`.
2. Open Terminal.
3. Verify the quarantine flag is present:
   ```bash
   xattr -l "/Applications/SqlLumen.app"
   ```
4. Remove the quarantine attribute recursively:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/SqlLumen.app"
   ```
5. Confirm the attribute is gone:
   ```bash
   xattr -l "/Applications/SqlLumen.app"
   ```
   If nothing prints for `com.apple.quarantine`, quarantine is removed.
6. Start the app from Finder. If Gatekeeper still prompts, right-click the app, choose **Open**, then confirm **Open**.

Use this only for binaries you trust.

## Project layout

```
<repo>/
├── src/                 # React app: components, lib (IPC wrappers), stores, styles, types
├── src-tauri/           # Rust backend, Tauri config, permissions, SQLite migrations, icons
├── e2e/                 # Playwright specs (including visual regression)
├── package.json         # Frontend scripts and dependencies
└── AGENTS.md            # Maintainer/agent notes: architecture, commands, testing gates
```

## Contributing

1. Complete **[Setup](#setup)** (including Playwright, cargo-nextest, and Rust coverage tools if you run the full suite), then stay on the latest dependencies with `pnpm install` as needed.
2. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test:all` (Vitest coverage, Rust with llvm-cov, Playwright) before opening a PR.
3. For behavior that depends on the native shell, verify with `pnpm tauri dev` when possible. See **[AGENTS.md](AGENTS.md)** for IPC conventions, directory map, and screenshot baseline workflow.

---

### Upgrade note (rename from older builds)

If you previously ran installs under **`io.mysqlclient.app`**, **`mysql-client.db`**, keychain service **`mysql-client`**, or log files **`mysql-client.*.log`**, those paths are **not** reused after this rename. The app now uses identifier **`app.sqllumen.desktop`**, local DB **`sqllumen.db`**, keychain service **`sqllumen`**, and log stem **`sqllumen`**. Re-enter saved passwords and migrate data manually if needed.

---

**Product name:** SqlLumen · **Version:** 0.1.0 (see `package.json` / `src-tauri/tauri.conf.json`) · **Identifier:** `app.sqllumen.desktop` · **Bundle short description:** cross-platform desktop MySQL/MariaDB client
