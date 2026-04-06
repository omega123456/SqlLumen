# AGENTS.md

Agent guidance for the **mysql-client** repo — a cross-platform desktop MySQL/MariaDB client built with **Tauri v2** (Rust backend) + **React 19 / TypeScript** (frontend). They communicate exclusively via Tauri IPC (`invoke`).

---

## Commands

```bash
# Development
pnpm tauri dev          # Full Tauri app (Rust + frontend) — preferred
pnpm dev                # Frontend only (Vite on port 1420, no Rust)

# Build
pnpm build              # tsc + Vite production build
pnpm tauri build        # Native app bundle (DMG / MSI)

# Testing — run pnpm test:all before finishing any change
pnpm test:all           # Vitest coverage + Rust coverage + full Playwright (non-negotiable gate)
pnpm test:coverage      # Vitest with v8 coverage (90% threshold lines/functions/statements)
pnpm test:rust          # Rust tests via nextest, no coverage instrumentation (fast)
pnpm test:rust:coverage # Rust tests via cargo-llvm-cov (needs cargo-llvm-cov + llvm-tools-preview)
pnpm test:e2e           # All Playwright specs under e2e/ (includes screenshots.spec.ts)
pnpm test:screenshots   # Visual regression only — e2e/screenshots.spec.ts

# Single Vitest test file
pnpm vitest run src/tests/path/to/file.test.ts

# Single Rust test suite (from repo root)
cargo nextest run --manifest-path src-tauri/Cargo.toml --features test-utils --test <suite_name>
# Example:
cargo nextest run --manifest-path src-tauri/Cargo.toml --features test-utils --test settings_integration

# Regenerate Playwright screenshot baselines after intentional visual changes
pnpm exec playwright test e2e/screenshots.spec.ts --update-snapshots

# Code quality
pnpm lint               # ESLint on src/
pnpm lint:fix           # ESLint auto-fix
pnpm format             # Prettier on src/
pnpm typecheck          # tsc --noEmit
```

**Cursor rule (always apply):** Before finishing a session where any code was changed, re-run `pnpm test:all` and ensure all tests are passing.

---

## Critical Rules for Agents

- **Tests live only in separate test files.** Never bundle tests with production code: no `*.test.ts` / `*.spec.ts` next to sources under `src/`, no `describe`/`it` blocks inside application modules, and (Rust) no `#[cfg(test)]` or `#[test]` in `src-tauri/src/` — use `src/tests/` (mirroring `src/`), `src-tauri/tests/`, and `e2e/` only.
- **`pnpm test:all` must be fully green before you are done.** Fix every failure regardless of whether you think your diff caused it — including pre-existing failures, unrelated suites, and screenshot baselines.
- **Never lower coverage thresholds.** 90% lines/functions/statements for both TypeScript (Vitest v8) and Rust (llvm-cov `--fail-under-*`). Improve tests instead.
- **No fixed delays > 5 s** in any test. Use condition-based waiting (Playwright auto-wait, `waitFor`, `findBy*`, polling).
- **Never add `istanbul`/`c8` ignore comments or widen `exclude` lists** to hide coverage gaps without explicit user approval naming what to exclude.
- **Package manager: `pnpm` only.** Do not use npm or yarn.

---

## Architecture

### IPC Boundary

The frontend **never** touches SQLite or MySQL directly. All backend work goes through typed `invoke()` wrappers in `src/lib/`.

**Adding a new Tauri command — full checklist:**

1. Implement `*_impl(state: &AppState, ...)` in `src-tauri/src/commands/` — testable without the Tauri runtime.
2. Write a thin `#[tauri::command]` wrapper that calls `*_impl`.
3. Register it in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.
4. Add a typed `invoke<T>('command_name', ...)` wrapper in the appropriate `src/lib/*-commands.ts`.
5. Add a `[[permission]]` block in `src-tauri/permissions/*.toml` with `commands.allow = ["your_command"]` (use snake_case Rust name, not camelCase).
6. Append `"allow-your-command"` to the `permissions` array in `src-tauri/capabilities/default.json`.
7. Update `src/lib/playwright-ipc-mock.ts` if the new command is called during any UI flow covered by E2E.

**Permission debugging:** A runtime `forbidden`/permission error almost always means a missing or mistyped entry in `capabilities/default.json` or a mismatch between the TOML `commands.allow` name and the registered Rust name.

### Directory Map

```
src/
  lib/               # Typed invoke() wrappers (*-commands.ts) + utilities
  stores/            # Zustand global state (connection-, query-, table-data-, schema-, theme-store)
  components/
    common/          # Shared primitives — Button, TextInput, Checkbox, Dropdown, Textarea, …
    shared/          # Cross-feature building blocks (DataGrid wrapper, grid editors)
    layout/          # AppLayout, Sidebar, WorkspaceArea, ConnectionTabBar, StatusBar
    workspace/       # WorkspaceTabs
    query-editor/    # Monaco editor, ResultPanel, ResultGridView/FormView/TextView
    table-data/      # TableDataTab, TableDataGrid, TableDataFormView, TableDataToolbar
    table-designer/  # TableDesignerTab, ColumnEditor, IndexEditor, ForeignKeyEditor, …
    schema-info/
    dialogs/         # ExportDialog, ConfirmDialog, create/alter DB, DialogShell, …
    connection-dialog/
    object-browser/
  styles/            # tokens.css, global.css, data-grid-precision.css
  types/             # Shared TypeScript types (connection.ts, schema.ts, …)
  tests/             # Mirrors src/ layout; setup.ts mocks Tauri IPC + Monaco + polyfills

src-tauri/
  src/commands/      # Tauri command handlers (thin wrappers call *_impl)
  src/mysql/         # Pool, registry, query executor, health, table_data SQL
  src/db/            # SQLite helpers, CRUD repos, migrations runner
  src/export/        # csv/json/xlsx/sql writers
  src/logging/
  migrations/        # *.sql files compiled into the binary via include_str!
  tests/             # ALL Rust tests (never inline tests in src-tauri/src/)
  permissions/       # *.toml — one [[permission]] block per command
  capabilities/      # default.json — grants permissions to the "main" window
```

---

## Code Style

### TypeScript / React

- **Formatter:** Prettier — `semi: false`, `singleQuote: true`, `tabWidth: 2`, `trailingComma: "es5"`, `printWidth: 100`. Run `pnpm format` before committing.
- **TypeScript:** strict mode (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`). Prefer explicit return types on public functions; infer where obvious. Avoid `any`.
- **Imports:** Named imports preferred. Use `import type` for type-only imports. Rough order: external libs → `../lib/` → relative `./`.
- **Components:** Functional only. Use `forwardRef` for DOM-forwarding primitives. Props type named `<ComponentName>Props`.
- **Naming:** Components/types `PascalCase`; hooks `useCamelCase`; files/utilities `kebab-case`; constants `UPPER_SNAKE_CASE`.
- **CSS:** CSS Modules (`*.module.css`). Design tokens are CSS custom properties in `src/styles/tokens.css` scoped under `[data-theme="light|dark"]`. Never hard-code colors or spacing values.
- **State:** Zustand stores in `src/stores/`. Local state via `useState`/`useReducer`. Layout via `react-resizable-panels` v4 — sizes as strings (`"20%"`).
- **Reuse first:** Check `src/components/common/` and `src/components/shared/` before writing new UI primitives. Introduce a new shared component only when nothing existing fits or the user explicitly requests an abstraction.
- **react-data-grid:** Always use the shared `DataGrid` wrapper (`src/components/shared/DataGrid.tsx`). Do not reorder rows client-side when the backend owns sort order.

### Error Handling (TypeScript)

Silent error swallowing is **forbidden** without a log line:

- For DevTools detail: `console.error('[module-name] ...')` / `console.warn('[module-name] ...')` with a stable prefix.
- For user-visible failures: call `showErrorToast` (records an `error`-level log via `logFrontend`) in addition to any `console.error`.
- For operational non-user-visible failures that are caught but allow the UI to continue: call `logFrontend` at the appropriate level (`error`/`warn`/`info`) from `app-log-commands.ts`. Do **not** rely on `console` alone.
- `logFrontend` invoke failures are logged with the prefix `[app-log]`.

### Rust

- Use `tracing` macros (`warn!`, `error!`, `info!`) with context (operation, IDs, `?` on errors) for all non-trivial error paths. Do not swallow errors without a log line.
- `#[serde(rename_all = "camelCase")]` on all structs serialized over IPC.
- Command handlers are thin wrappers; business logic lives in `*_impl` functions taking `&AppState` (testable without the Tauri runtime).
- Never embed `#[cfg(test)]` or `#[test]` in `src-tauri/src/` — all tests go in `src-tauri/tests/` only.

---

## Testing Conventions

Keep every test in a dedicated file under the appropriate test root (`src/tests/`, `src-tauri/tests/`, `e2e/`). Production files must contain only shipping code.

### Vitest (TypeScript)

- Test files mirror source: `src/components/Foo.tsx` → `src/tests/components/Foo.test.tsx`.
- Setup file `src/tests/setup.ts` provides: `mockIPC` for Tauri IPC, Monaco mocks, jsdom polyfills (ResizeObserver, matchMedia, HTMLDialogElement). A missing mock throws `[vitest] Unmocked Tauri IPC command: <cmd>` — add new commands to the `mockIPC` handler in each test.
- After `render`, use `waitFor` / `findBy*` for async-mounted state; do not assert synchronously right after render.
- When a test drives an error path that logs to the console, spy and mock it: `vi.spyOn(console, 'error').mockImplementation(() => {})` and call `mockRestore()` in `afterEach`/`finally`. Still assert on observable behavior (UI, toasts, etc.).
- Tests ship alongside features in the same change set — not deferred.

### Rust

- Tests only in `src-tauri/tests/<area>_<focus>_integration.rs`. Name files after what they test, not meta-goals like `coverage_boost`.
- Use in-memory SQLite (`Connection::open_in_memory()`) — never mock the DB layer.
- After adding a new test file, register it in **both** aliases in `.cargo/config.toml`: `mysql-client-test-integration` and `mysql-client-llvm-cov`.
- Run with `pnpm test:rust` for fast iteration; `pnpm test:rust:coverage` for the coverage gate.

### Playwright (E2E + Visual Regression)

- Specs live in `e2e/`. `pnpm test:e2e` (and therefore `pnpm test:all`) always includes `screenshots.spec.ts`.
- Every new component / visible UI state needs screenshot coverage for **both light and dark** themes in `e2e/screenshots.spec.ts`.
- **Do not increase Playwright screenshot pixel tolerance** (or any visual diff threshold) to make tests pass; fix the UI/regression or intentionally update baselines instead.
- Add `data-testid` attributes on new layout surfaces when CSS modules prevent reliable selectors.
- Update `playwright-ipc-mock.ts` for any new IPC command called from the UI (`VITE_PLAYWRIGHT=true` build).
- After intentional visual changes, regenerate baselines: `pnpm exec playwright test e2e/screenshots.spec.ts --update-snapshots` and commit the updated snapshot files.
- **Skip screenshots** only when the change is non-visual plumbing or DOM/CSS is identical (pure refactor). When in doubt, add a baseline.

---

## Key Gotchas

- **ESLint 10 + react-hooks:** `pnpm.peerDependencyRules.allowedVersions.eslint: "10"` in `package.json` — do not remove; `eslint-plugin-react-hooks` hasn't declared ESLint 10 support yet.
- **`csp: null`** in `tauri.conf.json` is intentional for now.
- **Migrations** are compiled into the binary via `include_str!`. To add one: create `src-tauri/migrations/NNN_description.sql` and register it in the `MIGRATIONS` array in `src-tauri/src/db/migrations.rs`.
- **Monaco:** SQL worker wiring is in `main.tsx` / `src/lib/monaco-worker-setup.ts`. Keep Playwright and dev builds consistent when upgrading Monaco.
- **Theme:** Set `data-theme="light|dark"` on `document.documentElement`. Persist via `set_setting('theme', ...)` — fire-and-forget; IPC errors must not block the UI change.
- **Tracing visual/desktop bugs:** Use the Hypothesi Tauri MCP workflow described in `mcp_testing.md` for anything that does not reproduce in Playwright's web build (layout, focus, scrolling, cell editing, short-lived toasts). Update `mcp_testing.md` with any new findings.
