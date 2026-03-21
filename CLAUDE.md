# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A cross-platform desktop MySQL/MariaDB client built with **Tauri v2** (Rust backend) + **React 19 / TypeScript** (frontend). The Rust backend handles all MySQL connectivity, query execution, and local SQLite persistence. The frontend handles UI. They communicate exclusively via Tauri's IPC (`invoke`).

Target: Mac + Windows. In-progress — Phase 1 (foundation) complete, Phase 2 (MySQL connectivity) is next.

## Commands

```bash
# Development
pnpm tauri dev          # Start full Tauri app (preferred — runs both frontend and Rust)
pnpm dev                # Frontend only (Vite on port 1420, no Rust)

# Build
pnpm build              # TypeScript check + Vite production build
pnpm tauri build        # Full native app bundle (DMG / MSI)

# Testing
pnpm test               # Vitest (single run)
pnpm test:watch         # Vitest watch mode
pnpm test:coverage      # Vitest with v8 coverage (90% threshold on lines/functions/statements)
pnpm test:rust          # Rust unit tests (from repo root)
pnpm test:rust:coverage # Rust tests via cargo-llvm-cov (needs cargo-llvm-cov + llvm-tools-preview)
pnpm test:all           # test:coverage, test:rust:coverage, test:e2e — run after substantive changes
pnpm test:e2e           # Playwright e2e tests

# Rust tests (alternative)
cd src-tauri && cargo test

# Code quality
pnpm lint               # ESLint on src/
pnpm lint:fix           # ESLint auto-fix
pnpm format             # Prettier on src/
pnpm typecheck          # tsc --noEmit (no emit)
```

To run a single Vitest test file: `pnpm vitest run src/tests/path/to/file.test.ts`

**After every code change** (before treating work as done), run the full check below. Do not skip this: Vitest coverage thresholds must pass, Rust tests must pass, and **Playwright** E2E (`e2e/`) must pass.

```bash
pnpm test:all    # Vitest+coverage, Rust unit tests, then Playwright (starts Vite via playwright.config)
```

Equivalent manual steps: `pnpm test:coverage`, then `pnpm test:rust:coverage`, then `pnpm test:e2e`. Use `pnpm test:rust` for a fast Rust-only run without coverage instrumentation.

## Architecture

### IPC Boundary

The frontend **never** touches SQLite or MySQL directly. All persistence and database operations go through `src/lib/tauri-commands.ts`, which wraps `invoke()` calls to named Rust commands. When adding a new Tauri command:

1. Implement a `*_impl(state: &AppState, ...)` function in `src-tauri/src/commands/` (testable without Tauri runtime)
2. Write a thin `#[tauri::command]` wrapper that calls the `*_impl`
3. Register it in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`
4. Add a typed wrapper in `src/lib/tauri-commands.ts`

### Rust Backend Layout

```
src-tauri/src/
  lib.rs              # App entry point, DB init, command registration
  state.rs            # AppState (Mutex<Connection>)
  commands/
    mod.rs
    settings.rs       # get_setting / set_setting / get_all_settings
  db/
    mod.rs
    connection.rs     # open_database (WAL mode, foreign keys on)
    migrations.rs     # Migration runner — reads SQL via include_str!
    settings.rs       # SQL helpers for the settings table
  migrations/
    001_initial.sql   # Tables: settings, connections, connection_groups
```

### Adding a Migration

Migrations are **compiled into the binary** via `include_str!`. To add one:
1. Create `src-tauri/migrations/NNN_description.sql`
2. Add an entry to the `MIGRATIONS` const array in `src-tauri/src/db/migrations.rs`

The migration runner tracks applied migrations in a `_migrations` table and is idempotent.

### Frontend Layout

```
src/
  App.tsx             # Theme initialization + AppLayout
  main.tsx            # React entry point
  lib/
    tauri-commands.ts # All invoke() wrappers (typed)
  stores/
    theme-store.ts    # Zustand store for theme (light/dark/system)
  hooks/
    use-system-theme.ts
  components/layout/  # AppLayout, ConnectionTabBar, Sidebar, WorkspaceArea, StatusBar
  styles/
    tokens.css        # CSS custom properties (design tokens)
    global.css        # Base styles
    fonts.css         # JetBrains Mono
    reset.css
  tests/              # Mirrors src/ structure; setup in tests/setup.ts
```

### Theming

Theme is applied by setting `data-theme="light|dark"` on `document.documentElement` before React renders. The `useThemeStore` Zustand store persists the preference to SQLite via `set_setting('theme', ...)`. Theme switching is fire-and-forget — IPC errors don't block the UI change.

### CSS Conventions

- Component styles use CSS Modules (`*.module.css`)
- Design tokens are CSS custom properties in `src/styles/tokens.css`, scoped under `[data-theme="light"]` and `[data-theme="dark"]`
- Font: JetBrains Mono (`@fontsource/jetbrains-mono`)

### State Management

- **Global**: Zustand stores (`src/stores/`)
- **Layout**: `react-resizable-panels` v4 — use `Group`/`Panel`/`Separator` components; sizes as strings (`"20%"`); panel refs via `usePanelRef()`

## Testing Conventions

### New code requires tests

Treat tests as part of the feature, not a follow-up task. **Any new or materially changed behavior must ship with tests in the same change set** so `pnpm test:all` stays green and coverage thresholds hold.

| Area | Where to add tests |
|------|-------------------|
| React components, hooks, stores, frontend utilities | `src/tests/` — mirror the path under `src/` (e.g. `src/components/Foo.tsx` → `src/tests/components/Foo.test.tsx`) |
| Rust logic, commands (`*_impl`), DB helpers | `#[cfg(test)]` in the same module or integration tests under `src-tauri/tests/` as appropriate for the project |
| Critical user journeys spanning the full app | `e2e/` (Playwright) when the change warrants it — not every UI tweak needs E2E |

**Exceptions (no new tests):** purely cosmetic changes, comment-only edits, renames with no behavior change, or generated/boilerplate with no custom logic. When in doubt, add a small test.

- **Workflow:** After every substantive change, run `pnpm test:all` and fix failures or coverage gaps before finishing (includes Playwright).
- React tests: Vitest + jsdom + `@testing-library/react`. Setup file: `src/tests/setup.ts`
- E2E: Playwright in `e2e/`; `playwright.config.ts` runs `pnpm dev` as the web server with `VITE_PLAYWRIGHT=true`.
- Coverage thresholds: 90% lines/functions/statements. Branch threshold is intentionally omitted.
- Rust tests: inline `#[cfg(test)]` modules. Commands use in-memory SQLite (`Connection::open_in_memory()`) — never mock the database layer.
- Tests are built alongside features in each phase — not deferred.

## Key Gotchas

- **ESLint 10 + react-hooks**: `pnpm.peerDependencyRules.allowedVersions.eslint: "10"` is set in `package.json` because `eslint-plugin-react-hooks` hasn't declared ESLint 10 support yet. Don't remove it.
- **`csp: null`** in `tauri.conf.json` is intentional for now — will be tightened in a later phase.
- **Tauri v2 permissions**: Capability files live in `src-tauri/capabilities/`. Tauri v2 requires explicit permission grants for any plugin (fs, dialog, etc.).
- **Package manager**: `pnpm` only. Do not use npm or yarn.
