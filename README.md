# SqlLumen

A cross-platform **desktop MySQL / MariaDB client** built with [Tauri](https://tauri.app/) 2 and [React](https://react.dev/) 19 (TypeScript). The UI is a native shell—sidebar object browser, tabbed workspace, resizable panels, and status bar—with light/dark theming. **MySQL and MariaDB** access runs in the Rust backend; the frontend talks to the database only through Tauri IPC (`invoke`), with local **SQLite** for app settings, history, and other persisted data.

[feature-tour.webm](https://github.com/user-attachments/assets/f318bf9b-de73-4b57-b056-9d1151d0b6f1)


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
  - [Query results](#query-results)
  - [Command palette and shortcuts](#command-palette-and-shortcuts)
  - [Workspace tabs](#workspace-tabs)
  - [Object editor](#object-editor)
  - [Process list](#process-list)
  - [Appearance](#appearance)
  - [Settings and diagnostics](#settings-and-diagnostics)
  - [Copy To Another Host](#copy-to-another-host)
  - [BLOB viewing and editing](#blob-viewing-and-editing)
  - [Stack](#stack)
  - [Project layout](#project-layout)
  - [Contributing](#contributing)
  - [AGENTS.md](AGENTS.md)

## Features

- **Connections** — save and open connections; test connectivity from the connection dialog
- **Object browser** — navigate databases, tables, views, routines, triggers, events, and favorites from the tree. While you scroll through a large database, its row stays pinned to the top of the tree (click it to scroll back), and the connection header shows the active database
- **Command palette and shortcuts** — search objects, jump to recents, and filter by database or object type from the keyboard; shortcuts are customizable in Settings
- **Copy to Another Host** — copy selected tables, routines, triggers, and events from one database to a different saved host with progress tracking and cancel support
- **Query editor** — Monaco-based SQL editing with formatting, completion-oriented tooling, multi-statement execution, and AI diff/review integration
  - All query editor windows of a connection share one MySQL session, so user variables (`SET @x`), `USE`, temporary tables, and transactions (`START TRANSACTION` … `COMMIT`) carry over between runs and windows. The session runs one query at a time: a run in another window waits until the current query finishes. Table data tabs, the schema browser, the object editor, and result-grid edits use separate background connections.
- **Workspace tabs** — inline query-tab rename plus context-menu and drag/drop reordering for workspace and connection tabs
- **Connection workspace retention** — each open connection session keeps its full workspace mounted while you switch between connection tabs, so table-data and query-result grids preserve their scroll position and local view state when you switch to another connection and return. Only the visible connection is interactive; background connections are hidden and inert. Retention lasts until the session is closed. Heavy row payloads from long-idle inactive connections may still be released and transparently restored from cache under the existing results cache lifecycle, while the grid's mounted scroll position is preserved.
- **Result sets** — grid, form, and text views; execution feedback and toolbars. Large results stay fast: rows load in windows as you scroll (see [Query results](#query-results)). For a successful query-editor result, the bottom status bar shows the row count (the same string as the result toolbar, e.g. `12,340 rows`, `2,340 of 12,340 rows` or `100,000+ rows · truncated`) followed by `Exec <n> ms` (server execution time only, up to when the first row / result header is available) and `Total <n> ms` (execution plus row transfer and serialization), rendered identically in light and dark themes. For DML/DDL or empty result sets, `Exec` and `Total` are equal. The result-editor toolbar badge and Query History `duration_ms` continue to report the combined total time.
- **Table data** — browse and edit rows with validation and related UI (foreign keys, unsaved changes, BLOB editing)
- **BLOB viewer / editor** — double-click a binary cell to inspect its bytes as an image, text, or hex dump; in the table-data browser you can also replace, NULL, clear, and save the bytes (see [BLOB viewing and editing](#blob-viewing-and-editing))
- **Object editor** — create and alter views, procedures, functions, triggers, and events with Monaco-backed DDL editing, preview, and save flow
- **Process list** — monitor live server activity per connection with refresh, filtering, and kill actions
- **Table designer** — column, index, and foreign-key editing with DDL preview and apply flow
- **Schema information** — columns, indexes, foreign keys, DDL, and stats-style panels where supported
- **Import / export** — data and SQL-oriented workflows (e.g. CSV, JSON, XLSX, SQL dump paths—see in-app dialogs)
- **History & favorites** — query history (filter by time range, search statements, clear the connection's history, and inspect a selected entry's status, SQL, duration, rows and connection) and saved snippets/favorites; right-click in the query editor and choose **Save as Favorite** to save the current selection (or the statement under the cursor) as a new favorite, pre-populated in the favorites dialog
- **Settings** — General, Editor, Results, Logging, Shortcuts, AI, and Updates preferences; theme (light / dark / system) persisted locally; current workspace session restored on relaunch and auto-saved on close / every 5 minutes when enabled. Results settings include the opt-in "Show table data tabs in bottom panel" toggle, which scopes table-data tabs to the active query editor and shows them alongside query results in the lower result panel. Results settings also include "Max open tabs per group" (see [Workspace tabs](#workspace-tabs)). Logging settings embed an inline log viewer with refresh, filtering, and CSV export. Updates settings handles update checks, downloads, and restart prompts.
- Renderer reloads reuse native database sessions. If reconnection fails after restart, SqlLumen keeps the last saved workspace for a later restore.
- **Session Snapshots** — open **Session Snapshots** from the app toolbar to capture the current set of open connections and workspace tabs on demand, restore an earlier session, or delete old snapshots. Restoring first creates a safety snapshot of the current session when there is anything open, then force-closes the current session before replaying the saved one. Snapshot cadence (`Off`, `On Close`, `Daily`, `Weekly`) and retention count are configurable in Settings.
- **AI Assistant** — in-app assistant workflows for SQL tasks and product guidance, with per-tab panel state preserved across workspace tab switches, longer local-model timeouts (~5+ minutes for generation), same-tab schema-context reuse, and stable inline context prefixes that preserve follow-up prompt-cache reuse. Those prefixes also remain compatible with OpenAI-compatible local providers that enforce stricter system-message ordering, including vLLM. OpenAI-compatible Responses API chaining with automatic chat-completions fallback is supported where available. Use `/remember <text>` in the AI chat to save scope-aware memories for the current connection, group, or global scope; the default scope is configurable in AI Settings, and saved memories can be managed there as well. AI Settings exposes a **Chat Base URL** for chat completions and an optional **Embedding Base URL** for embedding models (used by schema search and saved memories); when the embedding URL is left blank, embeddings fall back to the chat URL, so existing single-server setups keep working unchanged. The default AI retrieval settings are now `Top-K per query = 30` and `Top-N results = 20`.
- **Native desktop app** — smaller footprint than typical Electron stacks; bundles via Tauri

## Query results

Query-editor results are kept in the app's native result cache and shown in **windows**: the first 1,000 rows arrive with the result, and further rows load as you scroll (rows that are still loading show as grey placeholder bars; after a second, the toolbar says "Loading rows X–Y…"). This keeps large results responsive and memory use low, no matter how many rows a query returns.

- **Row ceiling.** Settings ▸ Results ▸ **Maximum rows kept per result** (default 100,000, 1,000–1,000,000) bounds how many rows any result keeps, including queries with their own `LIMIT` and stored procedure (`CALL`) results. A result that reaches it is marked **truncated**: the toolbar and status bar show `100,000+ rows · truncated`, the result sub-tab shows a warning icon, and a notice above the grid reads "Showing the first 100,000 rows". A new value applies to queries run after you save; results already shown are not trimmed. The **Row limit** (auto-`LIMIT`, default 500) is capped by this maximum.
- **Exporting truncated results.** For a truncated plain `SELECT`, the notice offers **Export all rows…**, which opens the Export dialog with "All rows" preselected. Truncated `CALL` results and locking queries (`FOR UPDATE`, `FOR SHARE`, `LOCK IN SHARE MODE`) can't be exported in full, because exporting them would run the procedure again (repeating its changes) or take the locks again; the notice says why. The same applies when the database a truncated query ran in couldn't be recorded (run the query again). Export of any other result writes the current view: the active sort and filter applied, deleted rows excluded.
- **Full export of all rows.** In the Export dialog of a truncated, re-runnable result, **Rows** offers *Current view* (the rows in memory, with your sort and filter, no re-run) or *All rows · re-runs the query*. All rows re-runs the query's SQL on the editor session with no auto-`LIMIT` and no row ceiling, and streams every row straight to the file (CSV, JSON, SQL INSERT or Excel), so it is not limited by the maximum rows kept per result. The grid's sort and filter are **not** applied (the dialog warns when they are active, with **Use current view** to switch back), and a re-run can return different rows than the grid shows if the data changed. The dialog shows rows written, megabytes and elapsed time, and **Cancel export** stops the query. Rows are written to `<file>.tmp`, which replaces the target only when the export completes; a cancelled or failed export writes no file and leaves an existing file untouched. You can close the dialog or switch tabs while it runs: the export keeps going, reopening Export shows its progress, and an "Export completed" notification appears when it finishes, even if the tab is in the background. Closing the query tab or disconnecting cancels it. While the export runs, other queries on the same connection wait for it, because they share the editor session.
- **Excel sheet limit.** An Excel sheet holds at most 1,048,576 rows, so an All rows export to `.xlsx` stops there (1,048,575 data rows with headers); the dialog warns before you start (**Switch to CSV**), and the completion notification says when the limit was hit. Excel column widths are sized from the first 1,000 rows.
- **Database during a full export.** The re-run uses the database the query originally ran in: if the editor session has since switched (for example with `USE` or the sidebar), the export switches to the original database first and switches back afterwards, whether the export completes, is cancelled or fails. If the query ran with no database selected, the export runs in the session's current database. If the session had no database selected before the export, it can't be switched back to "no database" and stays on the query's database (MySQL has no way to unselect a database); if switching back fails, the completion notification says so.
- **Sort and filter run in the result cache.** Clearing a sort restores the original order instantly, without re-running the query. Each sort starts from the original order, so successive sorts no longer stack (sorting by A, then by B, no longer keeps A as the tie-breaker). Sort and filter now survive a re-run (changing the row limit, re-running a result, restoring expired results, or the refresh after a cloned row is saved) in one step. The `LIKE` / `NOT LIKE` filters follow MySQL: case-insensitive, and `%` and `_` also match line breaks.
- **Edits and deletes.** Saving an edit updates the row you edited even while a sort or filter is active. Deleting checked rows no longer re-runs the query: the deleted rows are removed from the cached result, its counts and later exports. You can delete up to 10,000 checked rows at a time (above 1,000 the confirmation warns that it can take a while); checking more shows an explanation and deletes nothing. If the cached result can't be updated after a delete, a "Refresh failed" message asks you to re-run the query.
- **Rows outside the loaded window.** Copy (including Cmd/Ctrl+C and select-all), Cut, the Delete-key clear, Paste, copying checked rows, deleting checked rows, the form view and FK lookup load the rows they need first. Nothing is written until every row has loaded; after a second the toolbar shows progress (for example "Copying… 4,000 of 12,340") with **Cancel** for large selections (Escape also cancels), and a failure shows an error such as "Copy failed". Rows are edited one at a time, so pasting several lines in edit mode pastes only the first line into the target row and says the other lines were skipped.
- **Text view** shows the first 5,000 rows of the current view; when there are more, a strip says so and the copy button reads **Copy first 5,000**. Use export for the full result.

## Command palette and shortcuts

Press **F2** to open the command palette and search the active connection's schema. The palette supports recent objects when nothing is typed, and slash filters such as database names and object types to narrow the search quickly. Press **Shift+F2** on a table data view to open the palette scoped to that table so you can search its columns directly. Each result shows its kind and database (for example "Table · ecommerce_db"), table rows offer **Tab** to search their columns, and a footer lists the palette's keys.

The default shortcuts are editable in **Settings > Shortcuts**. The current defaults include:

- `F9` to execute the current query statement
- `Ctrl+Shift+Enter` to execute all statements in the editor
- `F12` to format the current selection or statement
- `Ctrl+S` to save the current file or DDL tab
- `Ctrl+,` to open Settings
- `Shift+F1` to reveal the active tab's table, view, or routine in the object browser

In the query editor, `Ctrl+H` or `Ctrl+Shift+R` (or `Cmd` on macOS) opens Find and Replace.

## Workspace tabs

SqlLumen groups non-pinned workspace tabs by tab type so the tab strip stays usable as a session grows. You switch groups in a narrow rail at the workspace's left edge, and the row below the connection tabs shows the current group's tabs.

- The group rail lists every group with open tabs (`Queries`, `Tables`, `Designers`, `Schema`, `Objects`) as its icon over its tab count. Click a group to switch to its most recently used tab. The current group has a marker on the left edge, and hovering a group shows its name and tab count. A dot marks a group with unsaved designer or editor changes. Groups fade in and out as their first tab opens or their last tab closes, and the rail stays visible even when only one group is open.
- The pinned `History` and `Process list` tabs sit at the bottom of the rail as icons, below a divider; hovering one shows its name. While one of them is selected, the marker moves to it and the tab row is hidden, so the history or process list fills the workspace.
- The rail is a single tab stop. `ArrowUp` / `ArrowDown` (and `Home` / `End`) move through the groups and then `History` and `Process list`, `ArrowRight` moves focus into the group's tabs, and `ArrowUp` on a tab moves focus back to the rail.
- With **Show table data tabs in bottom panel** on, table data tabs live in their query tab's result panel and belong to no group, so the rail has no `Tables` group and the `Queries` count covers query tabs only.
- The row shows only the tabs of the current group, so rename, drag/reorder, close, dirty markers, and existing per-tab actions still happen on concrete tabs.
- The selected tab is marked by its label and icon in the accent colour.
- The `+` button at the end of the row always opens a new query tab. A new connection starts with one blank query tab, so its rail and row are never empty; session restore brings back the saved tabs instead.
- Session restore does not save extra stack UI state. Restored tabs regroup naturally from their tab types, and per-stack recency starts fresh after relaunch.
- Right-click a member tab (or press Shift+F10 / the Menu key) for **Close tabs to the left** / **Close tabs to the right**. These close only tabs in the same group, and tabs with unsaved changes still ask before closing.
- On a table, view, routine, trigger, or event tab, the same menu offers **Reveal in object browser** (`Shift+F1`). It selects and focuses the object in the tree, switches the sidebar back from favorites, clears a filter that hides the object, and makes its database the active one. It is disabled for objects that are still being created, and query, history, and process list tabs do not show it.
- **Settings → Results → Max open tabs per group** (default `Unlimited`) caps how many tabs each group keeps open. Opening a tab past the limit closes the least recently used tab in that group. `Queries` tabs are never limited, and table data, table designer, and object editor tabs with unsaved changes are never closed automatically.

## Object editor

Use the object editor from the object browser to create or alter stored objects such as views, procedures, functions, triggers, and events.

- The body opens in Monaco with DDL syntax highlighting and editing support.
- New objects start from a generated template and transition into alter mode after the first successful save.
- Unsaved changes are tracked, and closing or switching away from a dirty tab prompts for save / discard / cancel.

## Process list

Open the Process list tab from the bottom of a connection's group rail to inspect live server activity for that session.

- The grid refreshes automatically at a configurable interval, and you can trigger a manual refresh at any time.
- You can filter out idle connections, sort rows, and inspect server-side session details.
- Selected queries can be killed from the toolbar, with a summary dialog before the action is applied.
- The tab is singleton-per-connection, so reopening it returns you to the same live view.

## Appearance

- **Fluent look** — SqlLumen uses the Windows 11 Fluent layer model on every platform: neutral grey surfaces, the Selawik UI font with JetBrains Mono for SQL and cell values, Fluent controls and focus rings, and the accent colour only for state (selection, focus, primary actions). The SQL editor and grids sit on a darker "well", and SQL uses the VS Code Dark+ / Light+ syntax colours.
- **Mica on Windows 11** — on Windows 11 the window gets the Mica backdrop behind the native title bar and the connection strip; work areas stay solid. Windows 10 and macOS keep the native title bar with solid colours.
- **Theme follows the OS** — the default theme is **System**, which tracks the OS light/dark setting live; choose Light or Dark in Settings → General (or the strip's theme button) to pin it. The native title bar follows the app theme.
- **Connection colour** — a connection's colour shows as a small marker on its connection tab and as a 2px edge across the top of its workspace (a 1px divider when the connection has no colour).
- **Inline result bars** — query errors, DML results and similar status messages appear as inline bars with an icon above the results instead of toasts; toasts are kept for background events.
- **Page headers** — schema info and the table designer open with an icon tile, the object name and a "Table · database" caption. Schema info for a table or view has **Alter table** and **View data** buttons that open the designer or the data tab.
- **AI assistant panel** — the panel opens at 340px wide; drag its edge to resize it.

## Settings and diagnostics

Settings is split into **General**, **Editor**, **Results**, **Logging**, **Shortcuts**, **AI**, and **Updates** sections.

- General settings cover application behavior, theme, zoom, and workspace/session restore.
- Results settings include the Row limit (auto-`LIMIT`), **Maximum rows kept per result** (the row ceiling, validated as a whole number from 1,000 to 1,000,000; Save is disabled while the value is invalid), and the opt-in "Show table data tabs in bottom panel" mode.
- Logging settings include the in-app log viewer, log level controls, and CSV export for diagnostics.
- Shortcuts settings let you inspect and remap the keyboard bindings used throughout the app.
- AI settings cover OpenAI-compatible endpoints, model selection, retrieval tuning, and `/remember` memory scope defaults, plus a dedicated memory manager for global, group, and connection memories.
- Updates settings manages release checks, downloads, and restart flow, including prompts when work is still open.

### Cached data storage and cleanup

SqlLumen keeps schema-cache and other derived data per saved connection in its local store.

- Schema-cache snapshots are stored as **one row per saved connection** (previously they could accumulate per connect session).
- Deleting a saved connection now removes **all of its cached and derived data** along with the connection itself.
- The first launch after upgrading runs a **one-time cleanup** that purges orphaned data left by older versions and reclaims the disk space it used.

## Copy To Another Host

Use **Copy to Another Host...** from the object browser context menu on a database, table, view-adjacent routine node, trigger, or event to open the transfer dialog.

- Choose a saved target connection on a different host. Read-only profiles and the source host are excluded from the target picker.
- Pick an existing target database or select **+ New database...** to create one as part of the copy.
- Select the objects to copy. Launching from a single object preselects that object; launching from a database starts with the full object list available.
- Expand **Options** to switch between `Structure + Data`, `Structure only`, or `Data only`, and to control `DROP IF EXISTS`, `CREATE IF NOT EXISTS`, insert mode, truncation, and `Ignore Definer`.
- Start the copy to monitor object-level progress, table row progress when available, and to cancel the job before it completes.

The target copy workflow temporarily disables foreign-key checks on the destination and restores them when the operation finishes.

## Session Snapshots

Open **Session Snapshots** from the app toolbar when you want to capture or roll back your current desktop workspace state.

- **Create manually** — click **Create Snapshot** to save the currently open connections and restorable workspace tabs immediately.
- **Restore safely** — pick a snapshot and click **Restore Snapshot**. If the current session has open connections, SqlLumen first saves a safety snapshot of that live session, then closes the current connections and restores the saved session. If the current session cannot be closed cleanly, the restore is aborted and the pre-restore session is recovered.
- **Delete** — use the trash action on a snapshot row to remove a snapshot you no longer want to keep.
- **Cadence and retention** — configure automatic snapshot cadence and how many snapshots to keep in **Settings**. Cadence options are `Off`, `On Close`, `Daily`, and `Weekly`; retention controls how many of the newest snapshots are preserved before older ones are pruned.

## BLOB viewing and editing

Binary columns (`BLOB`/`TINYBLOB`/`MEDIUMBLOB`/`LONGBLOB`/`BINARY`/`VARBINARY`) render as a `[BLOB - N bytes]` placeholder in the grid. **Double-click** the cell to open the BLOB viewer. It is also reachable from the **form view** of a record via the **View/Edit** button next to a binary field.

The viewer always offers three tabs:

- **Image** — renders the bytes as an image when they decode to a supported format (PNG, JPEG, GIF, WebP, BMP, SVG); otherwise it shows a "Not a valid image" state.
- **Text** — best-effort UTF-8 decode of the bytes (invalid sequences become the replacement character). Read-only.
- **Hex** — a classic hex dump with an offset column, 16 bytes per row (grouped 8 + 8), and an ASCII sidebar. Read-only.

The viewer behaves differently depending on where it is opened:

- **Table-data browser — full edit.** The cell's bytes are fetched lazily by primary key when the dialog opens. You can replace the value by **Load from file**, **Paste** (base64 or whitespace-tolerant hex), or **drag-and-drop** a file onto the dialog; **Set NULL** stages a SQL `NULL`; **Clear** stages an empty (`0 bytes`) value. **Apply** stages the change as a pending cell edit — the cell then shows `[BLOB - N bytes*]` (note the asterisk) and the new bytes are written to the database when you save the row through the normal update/insert flow. After saving, the cell reverts to a clean `[BLOB - N bytes]` placeholder.
- **Query results — view only.** Read-only result sets have no primary key to persist an edit against, so the dialog shows only the three tabs plus **Save to file** and **Close** — there are no edit, NULL, clear, or apply controls. The bytes are taken from the value already returned in the result row.

Rows whose **primary key is itself a binary column** (`BINARY`/`VARBINARY`/`BLOB`, or a composite key that includes one) are fully supported: editing and saving a row, deleting a row, and lazily loading a BLOB cell all match the row by its real key bytes, so these operations work correctly instead of failing to match.

**Save to file** (available in both surfaces, whenever bytes are held) opens a native save dialog. The default file extension is auto-detected from the leading magic bytes (for example `.png`, `.jpg`, `.gif`, `.pdf`, `.zip`), falling back to `.bin`.

**Size limits.** In the table-data browser a **10 MB cap** applies to both the lazy fetch and to files you load (from the file picker or drag-and-drop). When a stored cell exceeds the cap, the dialog shows a warning banner and the content/Save-to-file are suppressed (no bytes are transported) — save large values directly from the database instead. Note that **query-result blobs are not size-capped** (a known limitation): the bytes are whatever the query already inlined into the result set, so a very large binary value in a result set is transported in full.

Exported binary columns continue to be emitted as base64 in all export formats (CSV, JSON, XLSX, SQL); the BLOB viewer does not change export behavior.

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
7. **cargo-nextest (for Rust integration tests)** — This tool is not installed by `pnpm install`.
   The repo compiles the suites under `src-tauri/tests/integration/` into one `integration` target.
   Cargo aliases in `.cargo/config.toml` run this target. Install the tool from any directory:

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
| `pnpm test:rust`              | Rust integration tests via [cargo-nextest](https://nexte.st/) (`cargo sqllumen-test-integration`; single `integration` target and flags in `.cargo/config.toml`)                                                                                                                                                    |
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
