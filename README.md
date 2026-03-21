# MySQL Client

A desktop **MySQL / MariaDB client** built with [Tauri](https://tauri.app/) 2 and [React](https://react.dev/). The UI is a modern shell (sidebar, workspace, tabs, status bar) with light/dark theming. **Database connectivity is planned**; the current milestone focuses on app foundation, local settings, and tooling.

## Features

- **Native desktop app** — small footprint compared to Electron-style stacks
- **React + TypeScript** frontend with Vite
- **Resizable layout** — sidebar and main workspace via `react-resizable-panels`
- **Theming** — light, dark, or follow the OS; persisted locally
- **Local SQLite** (via Tauri/Rust) for settings and migrations
- **Tests** — Vitest for unit/component tests, Playwright for smoke E2E

## Requirements

| Tool | Notes |
|------|--------|
| [Node.js](https://nodejs.org/) | LTS recommended |
| [pnpm](https://pnpm.io/) | Package manager (`corepack enable` or install globally) |
| [Rust](https://www.rust-lang.org/tools/install) | Required to build the Tauri backend (`cargo`, `rustc`) |
| Rust coverage (optional) | For `pnpm test:rust:coverage` / `pnpm test:all`: `cargo install cargo-llvm-cov` and `rustup component add llvm-tools-preview` |
| OS deps | See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform |

## Setup

Follow these steps on a new machine before **Quick start** or **Contributing**.

1. **Node.js** — Install [Node.js](https://nodejs.org/) (LTS). Verify with `node -v`.
2. **pnpm** — Enable via Corepack (`corepack enable` then `corepack prepare pnpm@latest --activate`) or [install pnpm](https://pnpm.io/installation) globally. Verify with `pnpm -v`.
3. **Rust** — Install [rustup](https://www.rust-lang.org/tools/install) and the stable toolchain. Verify with `cargo -v` and `rustc -V`.
4. **Tauri OS dependencies** — Install the tools Tauri needs on your OS (compilers, WebView2 on Windows, etc.): [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
5. **Clone and install JS deps** — From the repo root:
   ```bash
   git clone <repository-url>
   cd mysql-client
   pnpm install
   ```
6. **Playwright (for E2E / `pnpm test:all`)** — Install browsers once (this project uses Chromium):
   ```bash
   pnpm exec playwright install chromium
   ```
7. **Rust coverage tools (for `pnpm test:rust:coverage` and `pnpm test:all`)** — Not installed by `pnpm install`. From any directory:
   ```bash
   rustup component add llvm-tools-preview
   cargo install cargo-llvm-cov
   ```
   Ensure `~/.cargo/bin` (or your Cargo bin directory) is on your `PATH` so `cargo llvm-cov` is found.

For day-to-day development you only need steps 1–5 and **Quick start** below. Add steps 6–7 when you run the full test suite.

## Quick start

From the repository root (after **[Setup](#setup)** if this is a fresh clone):

```bash
pnpm install
pnpm tauri dev
```

The dev server runs on [http://localhost:1420](http://localhost:1420) (configured in `src-tauri/tauri.conf.json`).

### Web-only UI (no native shell)

Useful for quick frontend iteration without the Rust toolchain:

```bash
pnpm dev
```

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Vite dev server |
| `pnpm build` | Typecheck + production frontend build |
| `pnpm preview` | Preview the built frontend |
| `pnpm tauri dev` | Run the full Tauri app in development |
| `pnpm tauri build` | Build installable bundles for your OS |
| `pnpm test` | Run Vitest once |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:coverage` | Vitest with coverage thresholds |
| `pnpm test:rust` | Rust unit tests (`cargo test` from repo root) |
| `pnpm test:rust:coverage` | Rust tests with [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) (summary to stdout; reports under `src-tauri/target/`) |
| `pnpm test:all` | Vitest coverage + Rust llvm-cov + Playwright E2E (run after substantive changes) |
| `pnpm test:e2e` | Playwright E2E tests |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm format` | Prettier on `src/` |
| `pnpm typecheck` | `tsc --noEmit` |

## Project layout

```
mysql-client/
├── src/                 # React application
├── src-tauri/           # Rust backend, Tauri config, SQLite migrations
├── e2e/                 # Playwright specs
└── package.json         # Frontend scripts and dependencies
```

## Roadmap

Work is tracked in phases; see `CONTEXT.md` and `.agent/plans/` in this repo for detail. **MySQL/MariaDB connectivity** is the next major milestone after the foundation.

## Contributing

1. Complete **[Setup](#setup)** (including Playwright and Rust coverage tools if you run the full suite), then stay on the latest dependencies with `pnpm install` as needed.
2. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test:all` (Vitest coverage, Rust with llvm-cov, Playwright) before opening a PR.
3. For UI changes that affect the desktop shell, verify with `pnpm tauri dev` when possible.

---

*Product name in bundles: **MySQL Client** · Identifier: `io.mysqlclient.app`*
