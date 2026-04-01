# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A cross-platform desktop MySQL/MariaDB client built with **Tauri v2** (Rust backend) + **React 19 / TypeScript** (frontend). The Rust backend handles all MySQL connectivity, query execution, result paging/sorting, export, table row CRUD, and local SQLite persistence. The frontend handles UI. They communicate exclusively via Tauri's IPC (`invoke`).

**Target:** Mac + Windows — in active development.

**Currently in the codebase:** local app data (SQLite + migrations), saved connections and groups, live MySQL sessions and pooling, object browser, SQL query editor (Monaco with SQL completion), result panel (react-data-grid grid view, form view, text view) with server-side sort/paging and export (CSV / JSON / XLSX / SQL INSERT), schema info tab, and a **table data** workspace (paginated react-data-grid + form editing, filters/sort via backend, unsaved-changes flow). Further polish and features continue by phase.

## Commands

```bash
# Development
pnpm tauri dev          # Start full Tauri app (preferred — runs both frontend and Rust)
pnpm dev                # Frontend only (Vite prefers 1420, falls back if busy; no Rust)

# Build
pnpm build              # TypeScript check + Vite production build
pnpm tauri build        # Full native app bundle (DMG / MSI)

# Testing
pnpm test:coverage      # Vitest with v8 coverage (90% threshold on lines/functions/statements)
pnpm test:rust:coverage # Rust tests via cargo-llvm-cov (needs cargo-llvm-cov + llvm-tools-preview)
pnpm test:all           # test:coverage, test:rust:coverage, test:e2e — run after substantive changes (includes screenshot baselines — see below)
pnpm test:e2e           # All Playwright specs under e2e/ (functional + screenshots.spec.ts)
pnpm test:screenshots   # Visual regression only — e2e/screenshots.spec.ts (faster than full e2e)

# Code quality
pnpm lint               # ESLint on src/
pnpm lint:fix           # ESLint auto-fix
pnpm format             # Prettier on src/
pnpm typecheck          # tsc --noEmit (no emit)
```

To run a single Vitest test file: `pnpm vitest run src/tests/path/to/file.test.ts`

**After every code change** (before treating work as done), run the full check below. Do not skip this: Vitest coverage thresholds must pass, Rust tests must pass, and **Playwright** E2E (`e2e/`) must pass — including **`e2e/screenshots.spec.ts`** (visual regression). The `test:all` script runs `pnpm test:e2e`, which executes **every** `*.spec.ts` in `e2e/`, so screenshot tests are always part of `test:all`.

**Critical:** If `pnpm test:all` fails, you must fix **every** failure before finishing — not only failures you think your diff caused. Do not treat unrelated suites, flaky-looking tests, or “already red” main as out of scope: diagnose, repair, update baselines when the change is intentional, or get explicit user direction. The bar is a **fully green** `test:all`, not “green for the files I touched.”

**Critical — agents must not (without explicit user override where noted):**

- **Lower coverage thresholds** — Do not reduce Vitest/v8 (or any) configured coverage percentages, quality gates, or equivalent bars to make the suite pass. Improve tests and coverage instead.
- **Add long fixed delays** — Do not introduce sleeps, `waitForTimeout`, or other fixed waits **longer than 5 seconds** in any test (Vitest, Playwright, or Rust). Prefer condition-based waiting (e.g. Playwright auto-waiting, `expect` retries, polling). Existing delays in the repo may stay unless you are changing them; when you change or add waits, keep each at **≤ 5 seconds**.
- **Exclude code from coverage** — Do not add `istanbul`/`c8` ignore comments, widen Vitest/coverage exclude lists, or otherwise omit files or lines from coverage to hide gaps. **Exception:** if the user gives **explicit permission** naming what to exclude (files, patterns, or lines), you may follow that direction only for the scope they approved.

```bash
pnpm test:all    # Vitest+coverage, Rust unit tests, then full Playwright (functional + screenshot baselines)
```

Equivalent manual steps: `pnpm test:coverage`, then `pnpm test:rust:coverage`, then `pnpm test:e2e`. Use `pnpm test:rust` for a fast Rust-only run without coverage instrumentation; use `pnpm test:screenshots` only when iterating on visuals.

## Architecture

### IPC Boundary

The frontend **never** touches SQLite or MySQL directly. All persistence and database work goes through typed `invoke()` wrappers under `src/lib/`. When adding a new Tauri command:

1. Implement a `*_impl(state: &AppState, ...)` function in `src-tauri/src/commands/` (or the relevant `src-tauri/src/mysql/` / `src-tauri/src/db/` helper), testable without the Tauri runtime where practical.
2. Write a thin `#[tauri::command]` wrapper that calls the `*_impl`.
3. Register it in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.
4. Add a typed wrapper in the appropriate `src/lib/*-commands.ts` file (`connection-commands.ts`, `schema-commands.ts`, `query-commands.ts`, `export-commands.ts`, `table-data-commands.ts`, etc.). Use `tauri-commands.ts` only for settings/theme helpers.

Playwright runs the web build with `VITE_PLAYWRIGHT=true`; extend **`src/lib/playwright-ipc-mock.ts`** when new UI depends on IPC so E2E stays deterministic.

### Rust Backend Layout

```
src-tauri/src/
  lib.rs              # App entry point, DB init, command registration
  main.rs
  state.rs            # AppState (shared resources for commands)
  credentials.rs
  logging/
  commands/
    mod.rs
    settings.rs       # get_setting / set_setting / get_all_settings
    connections.rs    # Saved connections (SQLite)
    connection_groups.rs
    session.rs        # open/close MySQL session, status
    mysql.rs          # MySQL-oriented command entrypoints
    schema.rs         # Schema listing / DDL-adjacent commands
    query.rs          # Execute query, result paging, sort
    export.rs         # Export result sets
    table_data.rs     # Table browse / row update insert delete / table export
  mysql/
    mod.rs
    pool.rs           # Connection pool per session
    registry.rs
    health.rs
    query_executor.rs # Query execution, sort, paging
    query_log.rs
    schema_queries.rs
    table_data.rs     # Table data SQL and row operations
  export/
    mod.rs            # csv_writer, json_writer, xlsx_writer, sql_writer
  db/
    mod.rs
    connection.rs     # open_database (WAL, foreign keys)
    connections.rs    # CRUD for saved connections
    connection_groups.rs
    migrations.rs
    settings.rs
  migrations/
    001_initial.sql   # settings, connections, connection_groups, …
```

### Adding a Migration

Migrations are **compiled into the binary** via `include_str!`. To add one:

1. Create `src-tauri/migrations/NNN_description.sql`
2. Add an entry to the `MIGRATIONS` const array in `src-tauri/src/db/migrations.rs`

The migration runner tracks applied migrations in a `_migrations` table and is idempotent.

### Frontend Layout

```
src/
  App.tsx
  main.tsx            # React entry; Monaco worker / Playwright hooks as needed
  lib/
    tauri-commands.ts       # Settings + theme persistence
    connection-commands.ts  # Saved connections, groups, open/close session
    schema-commands.ts      # Databases, objects, schema info, DDL helpers
    query-commands.ts       # executeQuery, result paging, sort, select DB, …
    export-commands.ts
    table-data-commands.ts  # fetch/update/insert/delete row, table export
    playwright-ipc-mock.ts
    result-cell-utils.ts    # Shared NULL/formatting for grid/form/text
    monaco-worker-setup.ts
  stores/
    theme-store.ts
    connection-store.ts
    workspace-store.ts      # Which workspace tab is active (query, table data, …)
    query-store.ts
    table-data-store.ts
    schema-store.ts
    toast-store.ts
  components/
    layout/           # AppLayout, Sidebar, WorkspaceArea, ConnectionTabBar, StatusBar
    workspace/        # WorkspaceTabs
    connection-dialog/
    object-browser/
    query-editor/     # Monaco, ResultPanel, ResultGridView, ResultFormView, ResultTextView, …
    table-data/       # TableDataTab, TableDataGrid, TableDataFormView, TableDataToolbar, UnsavedChangesDialog
    schema-info/
    dialogs/          # ExportDialog, ConfirmDialog, create/alter DB, …
    common/
  styles/
    tokens.css
    global.css
    fonts.css
    reset.css
    data-grid-precision.css # react-data-grid “Precision Studio” theme overrides
  types/
  tests/              # Mirrors src/; setup in tests/setup.ts
```

### Theming

Theme is applied by setting `data-theme="light|dark"` on `document.documentElement` before React renders. The `useThemeStore` Zustand store persists the preference to SQLite via `set_setting('theme', ...)`. Theme switching is fire-and-forget — IPC errors don't block the UI change.

### CSS Conventions

- Component styles use CSS Modules (`*.module.css`)
- Design tokens are CSS custom properties in `src/styles/tokens.css`, scoped under `[data-theme="light"]` and `[data-theme="dark"]`
- Font: JetBrains Mono (`@fontsource/jetbrains-mono`)
- **react-data-grid:** use the shared `DataGrid` wrapper (`src/components/shared/DataGrid.tsx`) which applies the `rdg-precision` CSS class and reads row/header heights from CSS tokens. Sort icons are Phosphor ArrowUp/ArrowDown via a custom `SortStatusRenderer`. Theme styling is in `data-grid-precision.css`. Client-side reordering is disabled where the backend owns sort order.

### State Management

- **Global:** Zustand stores (`src/stores/`)
- **Layout:** `react-resizable-panels` v4 — use `Group`/`Panel`/`Separator` components; sizes as strings (`"20%"`); panel refs via `usePanelRef()`

### Error handling and logging

**Silent error handling must always be logged** so failures are visible in devtools (frontend) and log files / stderr (Rust). “Silent” means the user sees no feedback and the error is not rethrown — e.g. empty `catch`, `.catch(() => {})`, `let _ = result`, `if let Err(_) = …` with no follow-up, or `Result`/`Option` dropped after an error branch.

- **Rust:** Use `tracing` at an appropriate level (`warn!`, `error!`, etc.) and include context (operation, ids, `?` on errors). Do not swallow errors without a log line unless the user explicitly asked for that behavior in the task.
- **TypeScript / React:** Use `console.error` or `console.warn` with a short, stable prefix (e.g. `[module-name]`) so grepping logs is easy. Prefer the same pattern when IPC or async work fails but the UI intentionally continues.

## Testing Conventions

### New code requires tests

Treat tests as part of the feature, not a follow-up task. **Any new or materially changed behavior must ship with tests in the same change set** so `pnpm test:all` stays green and coverage thresholds hold.

### Rust tests: separate files only

**Do not** embed tests in production Rust sources. Files under `src-tauri/src/` must not contain `#[cfg(test)]` modules, `#[test]` functions, or other test-only code. **Always** add or extend tests in dedicated files under `src-tauri/tests/` (new `*.rs` suites, helpers under `src-tauri/tests/common/`, etc.) and exercise the crate’s public API or `*_impl` entry points from there.

### Test file naming (Vitest and Rust)

**Do not** name suites after coverage or other meta goals (e.g. `coverage_boost`, `coverage_misc`, `threshold_helpers`). **Name files after what they test**: mirror the production path for the frontend (`src/lib/foo.ts` → `src/tests/lib/foo.test.ts`), and for Rust use clear `src-tauri/tests/<area>_<focus>_integration.rs` names (or extend the existing suite that already matches that area) so readers can tell which modules, commands, or behavior are under test.

| Area                                                | Where to add tests                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| React components, hooks, stores, frontend utilities | `src/tests/` — mirror the path under `src/` (e.g. `src/components/Foo.tsx` → `src/tests/components/Foo.test.tsx`) |
| Rust logic, commands (`*_impl`), DB helpers         | Dedicated files under `src-tauri/tests/` only — never inline tests in `src-tauri/src/`                            |
| Critical user journeys spanning the full app        | `e2e/` (Playwright) when the change warrants it — not every UI tweak needs E2E                                    |

### Playwright visual regression (screenshots)

The app has **no separate routes**; “screens” are distinct UI states (welcome, dialog open, connected, etc.). **Every new component or screen (state) that affects visible UI must get Playwright screenshot coverage** in the same change set:

1. Extend **`e2e/screenshots.spec.ts`** (or add a sibling spec if the file becomes unwieldy) with `expect(locator).toHaveScreenshot(...)` for **light and dark** themes, matching the existing pattern (`ensureTheme`, etc.).
2. Add stable **`data-testid`** hooks on new layout surfaces when CSS modules prevent reliable selectors (see existing layout/dialog testids).
3. If the new UI depends on Tauri IPC in the browser, extend **`src/lib/playwright-ipc-mock.ts`** (used when `VITE_PLAYWRIGHT=true`) so Playwright runs stay deterministic.
4. After **intentional** visual changes, regenerate baselines:  
   `pnpm exec playwright test e2e/screenshots.spec.ts --update-snapshots`  
   and commit the updated files under `e2e/screenshots.spec.ts-snapshots/`.

**Exceptions:** Skip **screenshots** only when output is unchanged (e.g. refactor with identical DOM/CSS) or the change is non-visual plumbing. Skip **Vitest/unit tests** only for comment-only edits, renames with no behavior change, or generated boilerplate with no custom logic. Purely cosmetic UI still needs updated screenshot baselines if pixels change. When in doubt, add coverage.

- **Workflow:** After every substantive change, run `pnpm test:all` and fix **all** failures or coverage gaps before finishing (Vitest, Rust, Playwright functional **and** screenshot baselines) — including any that pre-existed or appear unrelated to your edits; see the **Critical** note under Commands.
- React tests: Vitest + jsdom + `@testing-library/react`. Setup file: `src/tests/setup.ts`
- E2E: Playwright in `e2e/`; a pre-script (`scripts/ensure-playwright-port.mjs`) picks a free port and writes it to `.playwright-dev-port` before Playwright loads. The config reads that file and starts a fresh Vite dev server (`VITE_PLAYWRIGHT=true`) as the webServer. **`pnpm test:e2e` and therefore `pnpm test:all` always run `e2e/screenshots.spec.ts`** alongside functional specs.
- Coverage thresholds: 90% lines/functions/statements. Branch threshold is intentionally omitted.
- Rust tests: only in `src-tauri/tests/` (Nextest via `.cargo/config.toml`); no tests inside `src-tauri/src/`. Commands / DB tests use in-memory SQLite (`Connection::open_in_memory()`) — never mock the database layer.
- Tests are built alongside features in each phase — not deferred.

### Tracing visual bugs in the live app (MCP)

When a bug is **visual** or **desktop-specific** (layout, focus, scrolling, react-data-grid cell editing, short-lived toasts, or anything that does not reproduce cleanly in Playwright’s web build), trace it against the **real Tauri app** using the **Hypothesi Tauri MCP** workflow. Follow **`mcp_testing.md`** at the repository root for prerequisites, `driver_session`, webview interaction, log locations, and table-data grid/form automation notes.

**Maintain the documentation:** If you discover additional steps, pitfalls, stable selectors, or log paths that **`mcp_testing.md`** does not yet record, **update that file** in the same change set so the next agent or developer gets an accurate playbook.

## Key Gotchas

- **ESLint 10 + react-hooks**: `pnpm.peerDependencyRules.allowedVersions.eslint: "10"` is set in `package.json` because `eslint-plugin-react-hooks` hasn't declared ESLint 10 support yet. Don't remove it.
- **`csp: null`** in `tauri.conf.json` is intentional for now — will be tightened in a later phase.
- **Tauri v2 permissions**: Capability files live in `src-tauri/capabilities/`. Tauri v2 requires explicit permission grants for any plugin (fs, dialog, etc.).
- **Package manager**: `pnpm` only. Do not use npm or yarn.
- **Monaco editor**: SQL worker wiring lives in `main.tsx` / `src/lib/monaco-worker-setup.ts`; keep Playwright and dev builds consistent when upgrading Monaco.
