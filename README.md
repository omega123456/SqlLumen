# SqlLumen

A fast, lightweight **desktop MySQL and MariaDB client** for **Windows, macOS, and Linux**. SqlLumen pairs an object browser, a Monaco-based SQL editor, and a tabbed workspace with large-result handling, background data transfers, and an optional AI assistant. It is a native [Tauri](https://tauri.app/) 2 app: **database work runs in Rust**, and the React 19 UI talks to it over typed IPC.

[feature-tour.webm](https://github.com/user-attachments/assets/f318bf9b-de73-4b57-b056-9d1151d0b6f1)

## Contents

- [Installation](#installation)
  - [System requirements](#system-requirements)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Linux](#linux)
  - [Updating](#updating)
  - [Uninstalling](#uninstalling)
- [Features](#features)
- [Settings and diagnostics](#settings-and-diagnostics)
- [Development](#development)
- [Releasing](#releasing)
- [License](#license)

## Installation

Download the latest installer from **[GitHub Releases](https://github.com/omega123456/SqlLumen/releases/latest)**.

### System requirements

| OS          | Supported                                        | Release assets                |
| ----------- | ------------------------------------------------ | ----------------------------- |
| **Windows** | Windows 10 / 11, x64                             | `.exe` (NSIS setup) or `.msi` |
| **macOS**   | Apple Silicon (M-series)                         | `.dmg`                        |
| **Linux**   | x64, Ubuntu / Debian-based desktop distributions | `.deb` or `.AppImage`         |

Intel Macs are not currently built.

### Windows

1. Download the `…-setup.exe` (recommended) or the `.msi` from the [latest release](https://github.com/omega123456/SqlLumen/releases/latest).
2. Run the installer and follow the prompts. The installers are not code-signed, so SmartScreen may warn about an unrecognised publisher. Choose **More info → Run anyway**.
3. Launch **SqlLumen** from the Start menu.

Notes:

- **WebView2** is required. It ships with Windows 10 / 11; if it is missing, the installer fetches it.
- Windows 11 gets a native **Mica** window backdrop; Windows 10 uses a solid background.

### macOS

1. Download the `.dmg` from the [latest release](https://github.com/omega123456/SqlLumen/releases/latest).
2. Open the disk image and drag **SqlLumen** into **Applications**.
3. Clear the quarantine flag. The app is **not Apple-notarized**, so Gatekeeper reports it as "damaged" or refuses to open it otherwise:
   ```bash
   xattr -dr com.apple.quarantine /Applications/SqlLumen.app
   ```
4. Launch SqlLumen from Applications or Spotlight. If Gatekeeper still prompts, right-click the app, choose **Open**, then confirm **Open**.

Use this only for builds you trust. You need to do step 3 only for the first install, or after downloading a new `.dmg` by hand; in-app updates keep the flag cleared.

### Linux

SqlLumen publishes **Linux x64** builds for Ubuntu / Debian-based desktops. Two formats are available:

**`.deb` (Ubuntu / Debian)**

```bash
sudo apt install ./SqlLumen_x.x.x_amd64.deb
```

**AppImage (portable)**

```bash
chmod +x SqlLumen_*.AppImage
./SqlLumen_*.AppImage
```

Install the runtime libraries first if they are missing:

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-0 libappindicator3-1 libgtk-3-0 libxdo3 libssl3 librsvg2-2
```

Package names can vary slightly between releases. If one is unavailable, install the closest equivalent.

**Saved passwords** use the desktop keyring through the Secret Service API. [GNOME Keyring](https://wiki.gnome.org/Projects/GnomeKeyring) is the recommended provider. If saving or loading a password fails with a keyring-unavailable or locked message:

- Check that a Secret Service provider is running in your desktop session:
  ```bash
  busctl --user list | grep org.freedesktop.secrets
  ```
- If the keyring is locked, unlock it by signing in to your desktop session or by opening your keyring or passwords app. Then retry.
- Headless servers, WSL, and minimal window managers often have no user D-Bus session or Secret Service. Launch SqlLumen from a full desktop session so it can reach the keyring.

SqlLumen never stores database passwords outside the OS credential store.

### Updating

SqlLumen checks GitHub Releases for updates. When one is available, a banner appears in the app. Updates are signature-verified before they are installed. You can also check manually in **Settings → Updates**.

- **Windows** — download the update, then restart to finish.
- **macOS** — in-app updates work on supported installs.
- **Linux AppImage** — in-app updates work. After the download finishes, quit and reopen the app to apply it; Linux does not relaunch automatically.
- **Linux `.deb`** — does not use in-app updates. Download the newer `.deb` from [Releases](https://github.com/omega123456/SqlLumen/releases/latest) and install it over the old one.

### Uninstalling

- **Windows** — **Settings → Apps → Installed apps → SqlLumen → Uninstall**.
- **macOS** — quit SqlLumen and move `/Applications/SqlLumen.app` to the Trash. To remove settings and caches as well, delete `~/Library/Application Support/app.sqllumen.desktop` and `~/Library/Caches/app.sqllumen.desktop`.
- **Linux** — remove the `.deb` with your package manager (for example `sudo apt remove sqllumen`); delete the AppImage file for the portable build.

## Features

**Connections and navigation**

- **Connections page** — a full-window page lists your saved servers as tiles, grouped, with the four most recently used under **Recent** once more than six are saved. Click a tile (or focus it and press Enter) to connect; a server that is already open switches to its tab. To open another session of the same server, use the stacked-plus icon on its tile or **Open in new session** in its **…** menu. Each tile shows when you last connected, its user, and whether it is read-only or uses TLS. Arrow keys move between tiles and E edits one. The search field filters tiles as you type, and pasting a `mysql://` URL shows what it found with **Save and connect** or **Review all settings** (the password is never shown, and `mysqlx://` URLs are refused with a reason). If a server has no saved password and rejects the login, the tile asks for the password and can save it. With a session open, **+** in the tab bar shows the page over the workspace and Esc returns to it
- **Connection profiles** — a server's settings read as text in four sections (Server, Sign-in, Security, Name and behaviour); Edit opens one section at a time with Discard and Save in a bar at the bottom, and Test connection checks the settings on screen. Security offers five SSL modes: Disabled, Preferred (encrypt when the server supports it), Required, Verify CA, and Verify identity (also checks the certificate matches the host). A client certificate and key must be set together. Each profile can have a tab colour so you always know which server you are in
- **Object browser** — browse databases, tables, views, routines, triggers, events, and favourites from one tree. While you scroll a large database, the active database stays pinned at the top
- **Command palette** — search the active connection's schema, jump to recent objects, and filter by database or object type. On a table data view, the palette can search that table's columns
- **Workspace tabs** — query, table-data, schema, and designer tabs with inline rename, context-menu actions, and drag-and-drop reordering. Tab groups switch in a rail beside the tab strip
- **Session snapshots** — capture the open connections and tabs on demand, restore an earlier session, and let SqlLumen save snapshots on close, daily, or weekly (daily and weekly snapshots roll over at local midnight and on local Monday)

**Query editor**

- **Monaco SQL editor** — syntax highlighting, completion-oriented tooling, formatting, and find and replace
- **Schema-aware autocomplete** — databases, tables, columns, routines, and built-in functions, ranked for the clause you are in. Table aliases, CTE names and aliases, and derived-table aliases complete their columns after a `.`
- **Semantic highlighting** — the editor parses each statement and colours databases, tables, table aliases, columns, column aliases and function calls by their role, not just by word shape. Scripts longer than 200,000 characters keep the plain keyword colouring
- **Unknown table and column warnings** — while a connection's schema is loaded, a misspelled table (`FROM ordrs`) or database qualifier, or an unknown column of a qualified name (`u.emial`), gets a yellow squiggle with an "Unknown table" or "Unknown column" hover. Unqualified tables resolve against the latest `USE`, then the connection's active database, then the database selected in the object browser. Unqualified columns, CTEs, derived tables, tables the script creates, and the system schemas (`mysql`, `sys`, `information_schema`, `performance_schema`) are never flagged, and nothing is flagged without a connection or before the schema has loaded
- **Multi-statement execution** — run the statement at the cursor, or every statement in the editor
- **Execute all and copy result path** — for SQL handed over by a coding agent. Pick it from the arrow beside **Execute all**, or press Ctrl+Alt+Enter (⌘⌥↩ on macOS). SqlLumen creates a run folder under the OS temp folder (`sqllumen/agent-runs/<time>/`) and copies the path of its `run.md` to the clipboard as the run starts, ready to paste back to the agent. Every statement runs as usual and the grid shows each result up to the row ceiling, while every row, including those past the ceiling, is written to one CSV file per result set in query order, without the grid's sort and filter. The status bar shows the run's progress from any tab, with Cancel when you are on another tab; other tabs on the same connection wait until a long run finishes. A toast reports whether the run completed, was cancelled, stopped at an error or couldn't write a file. `run.md` records the same outcome and lists each statement's SQL with its row count, affected rows or error, the statements that did not run, and links to the CSVs. Cancelling keeps the rows written so far and marks that result as incomplete. In the CSVs, NULL is written as `\N` and binary values as `0x` hex. A truncated result from such a run offers **Copy run file path** instead of a full export. Run folders are readable only by your user and are deleted when SqlLumen starts once they are more than 7 days old. **Copy last run file path** in the same menu copies the latest path again
- **Shared session per connection** — all query windows of a connection share one MySQL session, so `SET @x`, `USE`, temporary tables, and transactions carry over between runs and windows
- **AI diff and review** — review generated changes as a diff before you apply them

**Results at scale**

- **Windowed results** — the first 1,000 rows arrive with the result, and the rest load as you scroll, so large result sets stay responsive
- **Row ceiling** — a configurable maximum (default 100,000 rows) keeps memory use bounded. Truncated results are marked clearly in the status bar and the result tab
- **Full export** — export a truncated result by re-running its SQL in the original database
- **Grid, form and text views** — table data and query results share one data view, so both offer grid, form and text view. Switching to form or text view and back keeps the grid's scroll position and checked rows. Table data pages are windowed like query results, and on table data too the status bar shows progress while checked rows are copied or deleted. When a cached table page expires, it reloads on its own, after any unsaved edit is saved or discarded. When rows or a sort or filter fail to load, table data shows the same Retry band as query results, and the status bar's Cancel stops a long copy on table data too
- **Inline editing** — edit table-data cells and grid rows directly, with the shared data grid used across table data and query results. Tab and Shift+Tab move to the next or previous column; pressing them while a cell editor is open saves the value first. Generated (virtual or stored) columns are read-only: their header shows **ƒx** and the form view labels them **(Generated)**
- **Clone row** — duplicate the clicked row, or the one checked row, into a new unsaved row. Every value is copied, including BLOB bytes up to 10 MB, except auto-increment, generated and binary key columns, which are left for the database or for you to fill in. Add row and Clone row also work when the only key is a NOT NULL unique key, and the grid scrolls to the new row

**Data transfer**

- **Copy to Another Host** — copy selected tables, routines, triggers, and events from one database to a different saved host, with progress tracking and cancel support
- **SQL dump and import** — export a database to SQL and import SQL files, running in the background
- **Export** — results and table data to CSV, JSON, XLSX, and SQL. Table-data SQL exports are written in UTC and set the time zone at the top of the file, so TIMESTAMP values import unchanged on any server
- **BLOB viewing and editing** — inspect and edit binary values in place. The Text and Hex tabs open at once and fill in progressively behind a loading indicator; Text previews the first 64 KB and Hex the first 16 KB of a larger value, so save to file to see all of it

**Schema and design**

- **Table designer** — create and alter tables: columns, indexes, and foreign keys in one editor
- **Object editor** — edit and save routine, trigger, event, and view definitions, and drop objects
- **Schema info** — inspect columns, indexes, and relations for any table or view, with **Alter table** and **View data** actions
- **Process list** — watch the server's running processes

**Look and feel**

- **Light, dark, or system theme** — follows the OS by default, with a Fluent-style interface and the SQL editor on a darker well
- **Native desktop app** — a smaller footprint than typical Electron apps, built on Tauri

## Settings and diagnostics

Open Settings from the app. It is split into:

- **General** — application behaviour, theme, zoom, and workspace and session restore
- **Editor** — editor behaviour and formatting
- **Results** — the auto-`LIMIT` row limit, the maximum rows kept per result, and table-data display options
- **Logging** — the in-app log viewer, log level, and CSV export for diagnostics
- **AI** — OpenAI-compatible endpoints, model selection, and memory scope for the assistant
- **Updates** — release checks, downloads, and the restart flow

## Development

Contributors and people who want to build from source need:

- [Node.js](https://nodejs.org/) LTS and [pnpm](https://pnpm.io/) (`corepack enable`)
- [Rust](https://www.rust-lang.org/tools/install) stable
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

```bash
git clone https://github.com/omega123456/SqlLumen.git
cd SqlLumen
pnpm install
pnpm tauri dev      # run the app with hot reload
pnpm tauri build    # build installable bundles for your OS
```

| Command                     | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `pnpm tauri dev`            | Run the full app (Rust and frontend)              |
| `pnpm dev`                  | Frontend only, on port 1420                       |
| `pnpm tauri build`          | Build installable bundles for your OS             |
| `pnpm test:all`             | Vitest, Rust, and Playwright suites with coverage |
| `pnpm lint` / `pnpm clippy` | Lint the frontend and the Rust backend            |
| `pnpm typecheck`            | TypeScript and `cargo check`                      |

For the full test suite, install the extra tools: `cargo install cargo-nextest cargo-llvm-cov`, `rustup component add llvm-tools-preview`, and `pnpm exec playwright install chromium`.

[CLAUDE.md](CLAUDE.md) covers architecture, IPC conventions, styling rules, and the test workflow for contributors.

## Releasing

The [release workflow](.github/workflows/release.yml) builds and publishes a GitHub Release with the Windows, macOS, and Linux assets above. It runs when a `v*` tag is pushed or when triggered manually from the Actions tab.

Run **`pnpm release:tauri-version`** to bump the version, write release notes, build, and then commit, tag, and push. The release notes live in [`.github/tauri-release-body.md`](.github/tauri-release-body.md).

## License

[MIT](LICENSE)
