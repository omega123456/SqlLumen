# SqlLumen

A desktop **MySQL / MariaDB client** built with [Tauri](https://tauri.app/) 2 and [React](https://react.dev/). The UI is a modern shell (sidebar, workspace, tabs, status bar) with light/dark theming. **Database connectivity is planned**; the current milestone focuses on app foundation, local settings, and tooling.

## Features

- **Native desktop app** — small footprint compared to Electron-style stacks
- **React + TypeScript** frontend with Vite
- **Resizable layout** — sidebar and main workspace via `react-resizable-panels`
- **Theming** — light, dark, or follow the OS; persisted locally
- **Local SQLite** (via Tauri/Rust) for settings and migrations
- **Tests** — Vitest for unit/component tests, Playwright for smoke E2E

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

The dev server prefers port **1420**. `pnpm tauri dev` picks that port automatically (or the next free one) and wires it into Tauri. `pnpm dev` (frontend-only) does the same via Vite's built-in fallback — check Vite's startup banner for the actual URL.

### Web-only UI (no native shell)

Useful for quick frontend iteration without the Rust toolchain:

```bash
pnpm dev
```

## Scripts

| Command                       | Purpose                                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                    | Vite dev server                                                                                                                                                      |
| `pnpm build`                  | Typecheck + production frontend build                                                                                                                                |
| `pnpm preview`                | Preview the built frontend                                                                                                                                           |
| `pnpm tauri dev`              | Run the full Tauri app in development                                                                                                                                |
| `pnpm tauri build`            | Build installable bundles for your OS                                                                                                                                |
| `pnpm test`                   | Run Vitest once                                                                                                                                                      |
| `pnpm test:watch`             | Vitest in watch mode                                                                                                                                                 |
| `pnpm test:coverage`          | Vitest with coverage thresholds                                                                                                                                      |
| `pnpm test:rust`              | Rust integration tests via [cargo-nextest](https://nexte.st/) (`cargo sqllumen-test-integration`; targets and flags in `.cargo/config.toml`)                     |
| `pnpm test:rust:coverage`     | Same tests under [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) (`cargo sqllumen-llvm-cov`; summary to stdout; artifacts under `src-tauri/target/`) |
| `pnpm test:all`               | Vitest coverage + Rust llvm-cov + Playwright E2E (run after substantive changes)                                                                                     |
| `pnpm test:e2e`               | Playwright E2E tests                                                                                                                                                 |
| `pnpm lint` / `pnpm lint:fix` | ESLint                                                                                                                                                               |
| `pnpm format`                 | Prettier on `src/`                                                                                                                                                   |
| `pnpm typecheck`              | `tsc --noEmit`                                                                                                                                                       |

## GitHub releases (CI)

The workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) builds **Windows** (x64) and **macOS** (Apple Silicon and Intel) bundles and uploads them to a **GitHub Release**. It runs on **`workflow_dispatch`** (Actions tab → Release → Run workflow) or when you push a version tag matching `v*` (e.g. `v0.1.0`).

1. Bump **`version`** in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) (and keep [`package.json`](package.json) in sync if you use it elsewhere).
2. Commit and push, then create and push the tag: `git tag v0.1.0 && git push origin v0.1.0`, or run the workflow manually after tagging.
3. If asset upload fails with a permissions error, set the repository’s **Settings → Actions → General → Workflow permissions** to **Read and write**.

Releases are created as **drafts** by default; publish them from the Releases page when ready. macOS artifacts from CI are **unsigned** unless you add Apple code signing secrets to the workflow—users may see Gatekeeper warnings until signing/notarization is configured ([Tauri macOS signing](https://v2.tauri.app/distribute/sign-macos/)).

## Project layout

```
<repo>/
├── src/                 # React application
├── src-tauri/           # Rust backend, Tauri config, SQLite migrations
├── e2e/                 # Playwright specs
└── package.json         # Frontend scripts and dependencies
```

## Roadmap

Work is tracked in phases; see `CONTEXT.md` and `.agent/plans/` in this repo for detail. **MySQL/MariaDB connectivity** is the next major milestone after the foundation.

## Contributing

1. Complete **[Setup](#setup)** (including Playwright, cargo-nextest, and Rust coverage tools if you run the full suite), then stay on the latest dependencies with `pnpm install` as needed.
2. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test:all` (Vitest coverage, Rust with llvm-cov, Playwright) before opening a PR.
3. For UI changes that affect the desktop shell, verify with `pnpm tauri dev` when possible.

---

### Upgrade note (rename from older builds)

If you previously ran installs under **`io.mysqlclient.app`**, **`mysql-client.db`**, keychain service **`mysql-client`**, or log files **`mysql-client.*.log`**, those paths are **not** reused after this rename. The app now uses identifier **`app.sqllumen.desktop`**, local DB **`sqllumen.db`**, keychain service **`sqllumen`**, and log stem **`sqllumen`**. Re-enter saved passwords and migrate data manually if needed.

---

_Product name in bundles: **SqlLumen** · Identifier: `app.sqllumen.desktop`_
