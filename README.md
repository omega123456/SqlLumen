# SqlLumen

A cross-platform **desktop MySQL / MariaDB client** built with [Tauri](https://tauri.app/) 2 and [React](https://react.dev/) 19 (TypeScript). The UI is a native shell—sidebar object browser, tabbed workspace, resizable panels, and status bar—with light/dark theming. **MySQL and MariaDB** access runs in the Rust backend; the frontend talks to the database only through Tauri IPC (`invoke`), with local **SQLite** for app settings, history, and other persisted data.

https://github.com/user-attachments/assets/839eface-faa6-4731-aa75-db1fa03ae11c



## Contents

- **Install & downloads**
  - [GitHub releases](#github-releases-ci)
  - [Install by OS](#install-by-operating-system)
  - [Linux (detailed)](#linux-installation-updates-and-saved-password-troubleshooting)
  - [macOS Gatekeeper / quarantine](#macos-quarantine-exclusion-step-by-step)
- **Develop locally**
  - [Requirements](#requirements)
  - [Setup](#setup)
  - [Quick start](#quick-start)
  - [Scripts](#scripts)
- **Reference**
  - [Features](#features)
  - [Stack](#stack)
  - [Project layout](#project-layout)
  - [Contributing](#contributing)
  - [AGENTS.md](AGENTS.md)

## Features

- **Connections** — save and open connections; test connectivity from the connection dialog
- **Object browser** — navigate databases, tables, views, and related objects
- **Query editor** — Monaco-based SQL editing with formatting and completion-oriented tooling
- **Workspace tabs** — inline query-tab rename plus context-menu and drag/drop reordering for workspace and connection tabs
- **Result sets** — grid, form, and text views; execution feedback and toolbars
- **Table data** — browse and edit rows with validation and related UI (foreign keys, unsaved changes)
- **Table designer** — column, index, and foreign-key editing with DDL preview and apply flow
- **Schema information** — columns, indexes, foreign keys, DDL, and stats-style panels where supported
- **Import / export** — data and SQL-oriented workflows (e.g. CSV, JSON, XLSX, SQL dump paths—see in-app dialogs)
- **History & favorites** — query history and saved snippets/favorites
- **Settings** — general, editor, and results preferences; theme (light / dark / system) persisted locally; current workspace session restored on relaunch and auto-saved on close / every 5 minutes when enabled. The Results settings page includes a "Show table data tabs in bottom panel" toggle (opt-in, off by default) that scopes table-data tabs to the active query editor and shows them alongside query results in the query editor's lower result panel.
- **AI Assistant** — in-app assistant workflows for SQL tasks and product guidance, with per-tab panel state preserved across workspace tab switches, longer local-model timeouts (~5+ minutes for generation), same-tab schema-context reuse, stable hidden schema/SQL context prefixes for better follow-up prompt-cache reuse on compatible local providers, and OpenAI-compatible Responses API chaining with automatic chat-completions fallback where supported. Use `/remember <text>` in the AI chat to save per-connection memories that persist across sessions and improve future AI responses. Manage saved memories in AI Settings.
- **Native desktop app** — smaller footprint than typical Electron stacks; bundles via Tauri

## Stack

| Layer         | Technologies                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Desktop shell | Tauri 2, Rust (async MySQL pool, migrations, export writers)                                                |
| UI            | React 19, TypeScript, Vite 8, Zustand, `react-resizable-panels`, Monaco                                     |
| Data grid     | `@glideapps/glide-data-grid` (via a shared app wrapper)                                                     |
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
| `pnpm test:e2e`               | Playwright E2E tests (all specs, including visual regression)                                                                                                                                                                                                                                   |
| `pnpm lint` / `pnpm lint:fix` | ESLint                                                                                                                                                                                                                                                                                          |
| `pnpm format`                 | Prettier on `src/`                                                                                                                                                                                                                                                                              |
| `pnpm typecheck`              | `tsc --noEmit`                                                                                                                                                                                                                                                                                  |

## GitHub releases (CI)

The workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) publishes GitHub Release assets for these currently shipped platforms:

| Platform              | Artifacts                                                  | Notes                                                                                                   |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| macOS (Apple Silicon) | `.app.tar.gz` updater artifact + `.dmg`                    | Used by Tauri in-app updates on supported installs; CI builds are unsigned unless signing is configured |
| Windows (x64)         | updater artifact + `.msi` / `.exe` installer bundles       | In-app updates download first, then restart to finish                                                   |
| Linux (x64)           | `.AppImage.tar.gz` updater artifact + `.AppImage` + `.deb` | AppImage participates in in-app updates; `.deb` is for manual install/reinstall on Ubuntu/Debian        |

The release workflow runs on **`workflow_dispatch`** (Actions tab → Release → Run workflow) or when you push a version tag matching `v*` (for example `v0.1.0`).

1. From the repo root, run **`pnpm release:tauri-version`** (see [`scripts/bump-tauri-version.mjs`](scripts/bump-tauri-version.mjs)). It interactively bumps **`version`** in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json), asks for **release notes** (press Enter to keep the default message), writes them to [`.github/tauri-release-body.md`](.github/tauri-release-body.md) for the [release workflow](.github/workflows/release.yml), runs **`pnpm build`** first; if the build fails it restores `tauri.conf.json` and the release body file and does **not** commit, tag, or push. On success it commits, creates the `v*` tag, and pushes the branch and tag. Keep [`package.json`](package.json) / [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml) aligned with the shipped version if your process requires it—the script only edits `tauri.conf.json` and the release body file.
2. Or bump `tauri.conf.json` yourself, commit and push, then create and push the tag (e.g. `git tag v0.1.0 && git push origin v0.1.0`), or run the workflow manually after tagging.
3. If asset upload fails with a permissions error, set the repository’s **Settings → Actions → General → Workflow permissions** to **Read and write**.

Release note copy stays aligned across the workflow fallback text, [`scripts/bump-tauri-version.mjs`](scripts/bump-tauri-version.mjs), and [`.github/tauri-release-body.md`](.github/tauri-release-body.md):

> See the release assets to download installers for Windows, macOS, Linux AppImage, and Linux .deb packages.

Releases are published directly (non-draft) by default. macOS artifacts from CI are **unsigned** unless you add Apple code signing secrets to the workflow—users may see Gatekeeper warnings until signing/notarization is configured ([Tauri macOS signing](https://v2.tauri.app/distribute/sign-macos/)).

## Install by operating system

Download installers from **[GitHub Releases](https://github.com/omega123456/SqlLumen/releases)**. Use the platform table below, then see the linked sections for prerequisites, updates, and troubleshooting.

| OS                        | Artifacts (CI)                          | Install                                                                                                        | In-app updates                                            | More detail                                                                                                                                           |
| ------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows (x64)**         | `.msi`, `.exe`, updater bundle          | Run the installer from the release asset.                                                                      | Yes — download then restart to finish.                    | [GitHub releases](#github-releases-ci)                                                                                                                |
| **macOS (Apple Silicon)** | `.dmg`, `.app.tar.gz`, updater artifact | Open the `.dmg` and drag **SqlLumen** to **Applications** (or use the packaged `.app` flow your release uses). | Yes on supported installs.                                | Unsigned CI builds: [macOS quarantine](#macos-quarantine-exclusion-step-by-step) · [Tauri macOS signing](https://v2.tauri.app/distribute/sign-macos/) |
| **Linux (x64)**           | `.deb`, `.AppImage`, `.AppImage.tar.gz` | **`.deb`:** `sudo apt install ./SqlLumen_x.x.x_amd64.deb` · **AppImage:** `chmod +x` then run.                 | **AppImage** only — `.deb` users reinstall from Releases. | [Linux installation](#linux-installation-updates-and-saved-password-troubleshooting) (prerequisites, keyring, restart-after-update)                   |

For **building from source** on any OS, use [Requirements](#requirements), [Setup](#setup), and [Quick start](#quick-start) instead of prebuilt installers.

## Linux installation, updates, and saved-password troubleshooting

SqlLumen currently publishes **Linux x64** release assets for users on **Ubuntu/Debian-derived desktop environments**.

### Linux prerequisites (runtime)

On Ubuntu/Debian, install the runtime libraries Tauri/WebKitGTK apps commonly need:

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-0 libappindicator3-1 libgtk-3-0 libxdo3 libssl3 librsvg2-2
```

Package names can vary slightly by distro release. If `apt` reports a package is unavailable, install the closest equivalent provided by your Ubuntu/Debian version.

### Linux installation

- **Ubuntu/Debian manual install (`.deb`)**

  Download the `.deb` asset from GitHub Releases, then install it with:

  ```bash
  sudo apt install ./SqlLumen_x.x.x_amd64.deb
  ```

- **Portable / updater-enabled install (AppImage)**

  Download the AppImage release asset, mark it executable if needed, and run it:

  ```bash
  chmod +x SqlLumen_*.AppImage
  ./SqlLumen_*.AppImage
  ```

### Linux in-app updates

- **AppImage** installs are the Linux path that participates in Tauri in-app updates.
- **`.deb`** installs do **not** use in-app updates. Re-download the newer `.deb` from GitHub Releases and reinstall it manually.
- When an update finishes downloading on Linux, SqlLumen shows a **Restart required** state. Quit the app and reopen it to finish applying the update; Linux does not auto-relaunch after download.

### Linux Secret Service / keyring troubleshooting

Saved passwords on Linux require a working **Secret Service** provider. **GNOME Keyring** is the recommended provider.

- **If password save/load fails** and SqlLumen mentions _"Linux Secret Service / keyring is unavailable or locked"_, verify that a Secret Service provider is installed and running for your desktop session.
- **Check whether a Secret Service is available**:

  ```bash
  busctl --user list | grep org.freedesktop.secrets
  ```

  If `org.freedesktop.secrets` is not present, no Secret Service provider is currently exposed on your user DBus session.

- **If the keyring is locked**, unlock it by logging into the desktop session normally or by opening your keyring/passwords app and unlocking the default keyring. Then retry the save/open action in SqlLumen.
- **Minimal desktop environments, CI, WSL, and headless servers** often do not provide a user DBus session or Secret Service implementation at all. In those environments, secure password storage may be unavailable until you run a full desktop session with a keyring service such as GNOME Keyring.
- **DBus session issues**: even with GNOME Keyring installed, SqlLumen cannot use secure storage unless it is started inside the same logged-in user session that owns the DBus session bus. Launching from ad-hoc shells, service managers, or stripped-down environments can break Secret Service discovery.

Do not work around this by storing database passwords insecurely outside the OS credential store.

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
3. For behavior that depends on the native shell, verify with `pnpm tauri dev` when possible. See **[CLAUDE.md](CLAUDE.md)** for IPC conventions, directory map, and screenshot baseline workflow.
