Agent guidance for the **SqlLumen** repo — a cross-platform desktop MySQL/MariaDB client built with **Tauri v2** (Rust backend) + **React 19 / TypeScript** (frontend). They communicate exclusively via Tauri IPC (`invoke`).

## Product Surface Note

- SqlLumen now includes an **AI Assistant** user-facing workflow. When changing related UI/IPC/backend behavior, keep the assistant paths covered by tests and document any user-visible behavior changes in `README.md`.

---

## Commands

```bash
# Development
pnpm tauri dev          # Full Tauri app (Rust + frontend) — preferred
pnpm dev                # Frontend only (Vite on port 1420, no Rust)

# Build
pnpm build              # tsc + Vite production build
pnpm tauri build        # Native app bundle (DMG / MSI)

# Testing — run targeted tests for the changed functionality before finishing
pnpm test:all           # Vitest coverage + Rust coverage + full Playwright (full-suite option)
pnpm test:coverage      # Vitest with v8 coverage (90% threshold lines/functions/statements)
pnpm test:rust          # Rust tests via nextest, no coverage instrumentation (fast)
pnpm test:rust:coverage # Rust tests via cargo-llvm-cov (needs cargo-llvm-cov + llvm-tools-preview)
pnpm test:e2e           # All Playwright specs under e2e/ (includes screenshots.spec.ts)

# Single Vitest test file
pnpm vitest run src/tests/path/to/file.test.ts

# Single Rust test or module (from repo root)
cargo nextest run --manifest-path src-tauri/Cargo.toml --features test-utils --test integration -E 'test(/<filter>/)'
# Example:
cargo nextest run --manifest-path src-tauri/Cargo.toml --features test-utils --test integration -E 'test(/settings_integration/)'

# Regenerate Playwright screenshot baselines after intentional visual changes
# Use test:e2e --update-snapshots to rebuild ALL baselines (screenshots.spec.ts + every other spec)
pnpm test:e2e -- --update-snapshots

# Code quality
pnpm lint               # ESLint on src/ + Rust else check (scripts/check-rust-else.mjs)
pnpm lint:fix           # ESLint auto-fix + Rust else check
pnpm format             # Prettier on src/
pnpm typecheck          # tsc --noEmit + cargo check
pnpm clippy             # Clippy on all Rust targets and features, -D warnings
```

**Lint rule (always apply):** `pnpm lint` and `pnpm clippy` must be clean after every change. Fix all lint warnings and errors, whether they are newly introduced or already existed in the touched code, before finishing.

**Agent rule (always apply):** Before finishing a session where any code was changed, run targeted tests that cover the changed functionality and ensure they are passing.

---

## Critical Rules for Agents

- **Tests live only in separate test files.** Never bundle tests with production code: no `*.test.ts` / `*.spec.ts` next to sources under `src/`, no `describe`/`it` blocks inside application modules, and (Rust) no `#[cfg(test)]` or `#[test]` in `src-tauri/src/` — use `src/tests/` (mirroring `src/`), `src-tauri/tests/`, and `e2e/` only.
- **Targeted tests for changed functionality must be green before you are done.** Run the most relevant Vitest, Rust, and/or Playwright tests for the touched area; fix failures in those impacted paths before finishing.
- **Never lower coverage thresholds.** 90% lines/functions/statements for both TypeScript (Vitest v8) and Rust (llvm-cov `--fail-under-*`). Improve tests instead.
- **No fixed delays > 5 s** in any test. Use condition-based waiting (Playwright auto-wait, `waitFor`, `findBy*`, polling).
- **Each individual test must complete in under 2 seconds.** Refactor slow tests to remove unnecessary setup and waiting.
- **Never add `istanbul`/`c8` ignore comments or widen `exclude` lists** to hide coverage gaps without explicit user approval naming what to exclude.
- **Package manager: `pnpm` only.** Do not use npm or yarn.
- **Lint must be genuinely clean.** See the **Lint rule** above — zero warnings/errors repo-wide, no suppressions, including for pre-existing issues encountered during the session.
- **Functions take at most 3 parameters.** Enforced by ESLint (`max-params: 3`) and Clippy (`too-many-arguments-threshold` in `src-tauri/clippy.toml`, run with `-D warnings`) within the lint scopes described below. In Rust, `&self` counts toward the limit. When a function needs more, group the values that travel together into a parameter struct/object, or move the method onto a type that already holds some of them, rather than adding an allow.
- **Coding-rule lints are switched on area by area and only ever widen.** ESLint rules take effect for the globs in their `files` list in `CONFORMANCE_RULE_SCOPES` (`eslint.config.js`; production `src/` only, never `src/tests/`). The Rust else check covers the paths in `RUST_PATHS_CHECKED_FOR_ELSE` (`scripts/check-rust-else.mjs`). Clippy restriction lints are enabled crate-wide in `[lints.clippy]` (`src-tauri/Cargo.toml`) or per module with `#![warn(clippy::…)]`. Code inside a scope must stay clean; never remove a path from a scope to make lint pass.
- **Every MySQL statement goes through the `logged_query` helpers.** Execute SQL only through `src-tauri/src/mysql/logged_query.rs` (`fetch_all` / `fetch_first` / `execute` / `stream` on a held connection, the `*_pooled` variants on a `BackgroundPool`), with `LoggedStatement::text` when no values are bound and a bound statement otherwise. The helpers log the SQL, binds, rows or results and errors through `query_log`; never call the mysql_async query methods directly.
- **Vitest IPC mocking is mandatory and centralized.** All Vitest tests that touch Tauri IPC must use the shared harness in `src/tests/ipc-mock.ts` plus `ipc.override(...)` / `ipc.emit(...)`. Do not create ad hoc IPC mocks, per-test `mockIPC(...)` calls, direct `vi.mock()` stubs for `@tauri-apps/api/*` IPC modules, or direct mocks of `src/lib/*-commands.ts` command wrappers. If a command is missing from the default fixtures, add it to `src/tests/fixtures.ts` or override it in the test. The intentional missing-mock failure is part of the contract and must not be bypassed.

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
  index.css          # Tailwind entry: @import, @plugin, @custom-variant and the @theme static token block
  styles/vendor/     # Hand-written CSS for third-party DOM only (Monaco, hljs, Glide overlays, datepicker, colour picker, resizable panels, fonts)
  types/             # Shared TypeScript types (connection.ts, schema.ts, …)
  tests/             # Mirrors src/ layout; setup.ts wires the shared IPC harness plus Monaco/polyfills

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
- **Styling:** Tailwind v4 utilities under the **Styling constraint** section below. Never add a `*.module.css` or any other stylesheet outside `src/index.css` and `src/styles/vendor/`.
- **State:** Zustand stores in `src/stores/`. Local state via `useState`/`useReducer`. Layout via `react-resizable-panels` v4 — sizes as strings (`"20%"`).
- **Shared UI primitives over native HTML:** Reuse existing components from `src/components/common/` and `src/components/shared/` (for example `Button`, `TextInput`, `Checkbox`, `Dropdown`, `Textarea`) for fields, actions, and controls. Do **not** drop in raw `<button>`, `<input>`, `<select>`, `<textarea>`, or other native equivalents when the codebase already has a component for that role. Add a new shared primitive only when nothing existing fits or the user explicitly asks for one.
- **Shared data grid:** Always use the shared `DataGrid` wrapper (`src/components/shared/DataGrid.tsx`). Do not reorder rows client-side when the backend owns sort order.
- **Dates:** Always use the `date-fns` library (already a dependency) for date arithmetic, parsing, comparison and formatting. Never hand-roll date calculations or format strings manually (for example `getFullYear()` / `padStart` chains or string-built timestamps).

### Error Handling (TypeScript)

Silent error swallowing is **forbidden** without a log line:

- Frontend logging must go through `src/lib/app-log-commands.ts` (`logFrontend` / helpers) as the only logging entrypoint.
- Do **not** call raw `console.error` / `console.warn` / `console.log` directly in frontend feature code; `src/lib/app-log-commands.ts` already handles console output.
- For user-visible failures: call `showErrorToast` (records an `error`-level log via `logFrontend`) and keep logging routed through `src/lib/app-log-commands.ts`.
- For operational non-user-visible failures that are caught but allow the UI to continue: call `logFrontend` at the appropriate level (`error`/`warn`/`info`) from `src/lib/app-log-commands.ts`. Do **not** rely on `console` alone.
- `logFrontend` invoke failures are logged with the prefix `[app-log]`.

### Rust

- Use `tracing` macros (`warn!`, `error!`, `info!`) with context (operation, IDs, `?` on errors) for all non-trivial error paths. Do not swallow errors without a log line.
- `#[serde(rename_all = "camelCase")]` on all structs serialized over IPC.
- Command handlers are thin wrappers; business logic lives in `*_impl` functions taking `&AppState` (testable without the Tauri runtime).
- Never embed `#[cfg(test)]` or `#[test]` in `src-tauri/src/` — all tests go in `src-tauri/tests/` only.
- **Dates:** `jiff` is the date-time library for new code: use it for date and time arithmetic, parsing, comparison and formatting (ADR `2026-11-16--jiff-is-the-date-time-library-it-renders-mysql-temporal-values-now-and-replaces-chrono-in-a-follow-up--0853e7c9.md`). `chrono` may only be used in files that already use it, until the follow-up plan moves them to jiff and removes chrono. Never hand-roll date calculations or format strings manually (for example string-built RFC 3339 timestamps or manual day-count math). The one exception is the partial-zero-date helper in `src-tauri/src/mysql/cell_values/`, because no calendar library can hold a MySQL date whose month or day is 0.

---

## Styling constraint (NON-NEGOTIABLE)

The migration plan is `.agent/plans/2026-11-14_tailwind-utilities-migration_plan.md`; the decision is recorded in `.agent/adr/2026-11-14--frontend-styling-is-tailwind-v4-utilities-with-paired-light-dark-theme-tokens--86110ad4.md`.

- **Pure Tailwind v4 utility classes only.** No custom CSS rules, no `@apply`, no square-bracket values or variants (`w-[237px]`, `data-[x]:`), no `!` important modifier, no `var(--` strings in components.
- **`src/index.css` contains only `@import`, `@plugin`, `@custom-variant` and the `@theme static` block.** Every colour, spacing, type step, radius, shadow, animation, breakpoint, easing and transition property is a **named token** there. Need a new value? Add a named token, then use the generated utility.
- **Colours are paired per theme.** Tokens are `--color-light-<name>` and `--color-dark-<name>` (names come from the Fluent primitives, for example `surface-container`, `fill-subtle-hover`). Write `bg-light-surface-container dark:bg-dark-surface-container`; every `-light-` utility has a `dark:` twin with the same variants. Never use `/NN` opacity modifiers; add a literal alpha token such as `primary-a35` instead. Colours identical in both themes have no theme prefix. `.dark` on `<html>` is the only theme switch; nothing writes `data-theme`.
- **Px, not rem.** `--spacing` is `4px`; named px tokens cover control heights, tree rows, grid rows and widths. Type-ramp tokens carry their line height (`text-body` is 14px/20px); use the size-only twin (`text-size-body`) only where a rule set just the font size, and a `leading-*` token for unitless line heights.
- **Class strings are full literals.** Never build them with interpolation. State picks classes through TypeScript lookup tables (`Record<Variant, string>` beside each primitive); never put two utilities for the same property on one element and never rely on cascade order. Shared strings live in `src/lib/class-names.ts` (`joinClassNames` is there too) and `src/lib/focus-ring.ts`; split the file by domain if it grows past the line limit.
- **Animations** use the `--animate-*` tokens; every animation has a `-paused` twin applied with `window-blurred:`. Buttons set an explicit `cursor-pointer` or `cursor-default`. Every `overflow-auto` element gets the shared scrollbar classes.
- **Inline `style`** is only for numbers computed at runtime. Read theme values from TypeScript only through `src/lib/theme-tokens.ts` (`currentTheme`, `readThemeColor`, `readToken`, `readPixelToken`, `observeThemeChange`).
- **Vendor CSS exception:** hand-written CSS is allowed only in `src/styles/vendor/` for DOM SqlLumen does not render (Monaco, highlight.js, Glide overlays, datepicker, colour picker, resizable panels, fonts), with no colour literals and colours only through `var(--color-light-…)` plus `.dark` twins.
- **Enforcement:** `src/tests/styles/tailwind-conformance.test.ts` (CSS file allowlist, `index.css` directives, vendor CSS theme variables, paired tokens, Fluent value table) and ESLint `local/tailwind-classes` (applied to all production `src/`).
- **Preflight is on** (`@import 'tailwindcss'`). `html`, `body` and `#root` take their base classes in `index.html`; there is no global element CSS. Preflight resets headings, lists, `pre`/`code`, `svg`, `p` wrapping and `textarea` resize, so a component sets those values itself, and every focusable control applies `FOCUS_RING` from `src/lib/focus-ring.ts`.
- **Base utilities replace global rules.** `<html>` carries the selection colours (`selection:`) and `svg:max-w-full canvas:max-w-full`; `<body>` carries `select-none` plus `selectable-descendants:select-text`, which re-enables text selection for inputs, textareas, `code`, `pre`, `.hljs`, `contenteditable` and grid cells. Window-blur animation pausing is the `window-blurred:` variant on our own utilities and one Monaco-scoped vendor rule.
- **Screenshot parity:** a styling migration must not change the baselines. Never update baselines or loosen thresholds to make a migration pass.

---

## Testing Conventions

Keep every test in a dedicated file under the appropriate test root (`src/tests/`, `src-tauri/tests/`, `e2e/`). Production files must contain only shipping code.

### Vitest (TypeScript)

- Test files mirror source: `src/components/Foo.tsx` → `src/tests/components/Foo.test.tsx`.
- Setup file `src/tests/setup.ts` provides Monaco mocks and jsdom polyfills (`ResizeObserver`, `matchMedia`, `HTMLDialogElement`) and wires Vitest IPC through the shared `src/tests/ipc-mock.ts` harness. A missing IPC fixture throws `[vitest] Unmocked Tauri IPC command: <cmd>`.
- Do **not** add ad hoc module mocks just to hit coverage on production code paths that can be exercised directly. **ALWAYS** test real behavior through the public API with the shared test harness and existing setup utilities. If a dependency is already globally mocked in `src/tests/setup.ts`, use that shared mock contract rather than overriding it locally unless there is no other practical option.
- Vitest IPC tests must always go through the shared `src/tests/ipc-mock.ts` harness. Use `ipc.override(...)` for per-test behavior and `ipc.emit(...)` for events. Do not bypass the harness with inline `mockIPC(...)`, ad hoc `vi.mock()` stubs, per-test IPC handlers, or direct wrapper mocks. If a test needs a new IPC response, extend `src/tests/fixtures.ts` or override only the specific command in that test.
- After `render`, use `waitFor` / `findBy*` for async-mounted state; do not assert synchronously right after render.
- Avoid React `act(...)` warnings in every test run:
  - Use `const user = userEvent.setup()` and await interactions (`await user.click(...)`) instead of fire-and-forget interaction calls.
  - Wrap direct external store mutations (`useXStore.setState(...)`) in `act(() => { ... })` whenever components from that store may be mounted.
  - If mount effects schedule async updates, wait for the resulting UI/store state with `waitFor` before the test exits.
  - When a test change introduces or exposes React `act(...)` warnings, treat that as unfinished work and clean the warnings up before completing the task.
- **Never assert on CSS classes** (`toHaveClass`, `className` checks, class selectors) in Vitest or Playwright. Assert role, `aria-*`, text, or a `data-*` attribute that is the lookup key (`data-variant`, `data-active`).
- Tests ship alongside features in the same change set — not deferred.

### Rust

- Tests only in `src-tauri/tests/integration/<area>_<focus>_integration.rs`. Name files after what they test, not meta-goals like `coverage_boost`.
- Add every new test file as a module in `src-tauri/tests/integration/main.rs`. Never add a Rust test file directly under `src-tauri/tests/`; that creates another expensive integration-test binary.
- Build Reqwest clients with `sqllumen_lib::http_client()` or `sqllumen_lib::http_client_builder()`. Never call `reqwest::Client::new()` or `reqwest::Client::builder()` directly.
- Use in-memory SQLite (`Connection::open_in_memory()`) — never mock the DB layer.
- Run with `pnpm test:rust` for fast iteration; `pnpm test:rust:coverage` for the coverage gate.

### Playwright (E2E + Visual Regression)

- Specs live in `e2e/`. `pnpm test:e2e` (and therefore `pnpm test:all`) always includes `screenshots.spec.ts`.
- Keep visual regression lean: each component gets at most one representative screenshot scenario
  in `e2e/screenshots.spec.ts`, run in both light and dark themes, plus at most two representative
  full-page scenarios. Cover additional states and interactions with functional assertions, and
  update the existing component scenario instead of adding another baseline.
- **Do not increase Playwright screenshot pixel tolerance** (or any visual diff threshold) to make tests pass; fix the UI/regression or intentionally update baselines instead.
- **Do not change screenshot threshold values in `playwright.config.mjs` (`expect.toHaveScreenshot`, including the value at `playwright.config.mjs:52`) unless the user gives explicit permission in the current request.**
- Add `data-testid` attributes on new layout surfaces. Select by `data-testid`, role, `aria-*` or a `data-*` attribute that is the lookup key (`data-variant`, `data-active`); never select or assert by a Tailwind utility class.
- Update `playwright-ipc-mock.ts` for any new IPC command called from the UI (`VITE_PLAYWRIGHT=true` build). When doing so, **never embed inline SQL-matching logic or fixture data directly in the `switch` cases** — all fixture data belongs in `src/tests/playwright-fixtures/` (one file per domain, e.g. `json-table.ts`, `users.ts`) and must be wired through the `FixtureRegistryApi` in `src/tests/playwright-fixtures/index.ts` so the data can be looked up and overridden per-test without touching the mock router.
- After intentional visual changes, regenerate baselines: `pnpm test:e2e -- --update-snapshots` and commit the updated snapshot files. This rebuilds all snapshots (not just `screenshots.spec.ts`).
- **Skip screenshots** only when the change is non-visual plumbing or DOM/CSS is identical (pure refactor). When in doubt, add a baseline.

---

## Key Gotchas

- **ESLint 10 + react-hooks:** `pnpm.peerDependencyRules.allowedVersions.eslint: "10"` in `package.json` — do not remove; `eslint-plugin-react-hooks` hasn't declared ESLint 10 support yet.
- **`csp: null`** in `tauri.conf.json` is intentional for now.
- **Migrations** are compiled into the binary via `include_str!`. To add one: create `src-tauri/migrations/NNN_description.sql` and register it in the `MIGRATIONS` array in `src-tauri/src/db/migrations.rs`.
- **Monaco:** SQL worker wiring is in `main.tsx` / `src/lib/monaco-worker-setup.ts`. Keep Playwright and dev builds consistent when upgrading Monaco.
- **mysql_async is the only MySQL driver** (ADR `2026-11-16--mysql-async-is-the-only-mysql-driver-…--0246cc44.md`):
  - Decode values only through `src-tauri/src/mysql/cell_values/` (decoder, JSON renderers, typed accessors). TINYINT, including `TINYINT(1)`, is always an integer, never a bool; no other file may match on `MYSQL_TYPE_` (a source-scan test enforces it).
  - Build connection options only with `mysql/connection_options.rs`, and pass the background pool as `BackgroundPool` (`mysql/pool.rs`) so its connect timeout travels with it. A pool replaced in the registry is dropped, never disconnected; only a closed connection's pool and job-owned pools are disconnected, in the background.
  - One-checkout rule: anything that changes session state (`USE`, `SET FOREIGN_KEY_CHECKS`, time zone) holds one checkout for its whole run and hands that connection to its runner. Pool reset clears session variables but not the current database, so every background query qualifies its database and table names.
  - Background connections run with server defaults. Transfer jobs (SQL dump, SQL import, copy-to-host source and target) take their connection with `BackgroundPool::checkout_for_transfer`, which sets `time_zone='+00:00'` first.
  - mysql_async is pinned to an upstream git commit until a crates.io release contains the rustls fixes #408 and #409 (ADR `…--7be14fcc.md`).
- **Theme:** Toggle the `dark` class on `document.documentElement` through `applyResolvedTheme` in `src/lib/theme-tokens.ts`. Persist via `set_setting('theme', ...)` — fire-and-forget; IPC errors must not block the UI change.
- **Tracing visual/desktop bugs:** For anything that does not reproduce in Playwright's web build (layout, focus, scrolling, cell editing, short-lived toasts, native window chrome), run `pnpm tauri dev` and drive the real app through the Hypothesi Tauri MCP bridge (`tauri-plugin-mcp-bridge`, registered for debug builds in `src-tauri/src/lib.rs`) with `@hypothesi/tauri-mcp-server`.
