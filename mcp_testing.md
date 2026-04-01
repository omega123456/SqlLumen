# MCP + Tauri manual testing: table data (grid & form)

This checklist repeats the process for driving the **mysql-client** desktop app via the **Hypothesi Tauri MCP** bridge, opening **`pi_management`.`permissions`**, inserting a row in **grid** and **form** view, and checking logs. Adapt database/table names if your target differs.

**After every meaningful interaction** (e.g. connect, open a table, add or edit a row, save, switch grid/form, refresh), confirm there were **no new errors**: use **`read_logs` → console** (§7), the **dev terminal** (§8), and especially the **on-disk application log** (§8 — tail today’s file and scan for `ERROR` / `WARN` lines). Silent backend failures may not show a lasting toast; the log file is the durable source of truth alongside stderr.

## Prerequisites

1. **Tauri dev build** with the MCP bridge enabled (see `AGENTS.md` / `tauri.conf.json` — `withGlobalTauri: true`, bridge plugin on `127.0.0.1:9223` or the next free port in `9223–9322`).
2. **MySQL** reachable from the machine, with a user that can **INSERT** into `pi_management.permissions` (and any NOT NULL / FK constraints satisfied).
3. **Cursor MCP** configured to run `pnpm exec mcp-server-tauri` (or your project’s equivalent) so tools like `driver_session` and `webview_*` are available.
4. **Optional but recommended:** Open your **`logs`** folder in a terminal or editor (paths in §8) so you can **`tail -f`** (or **Get-Content -Wait** on Windows) the current day’s **`mysql-client.*.log`** while testing.

## 1. Start the app

```bash
pnpm tauri dev
```

Keep the window open until testing is finished.

## 2. Attach the MCP driver

In the agent chat, call **`driver_session`** with `action: "start"` (optional `port` if the bridge is not on `9223`). Use `action: "status"` to confirm the session.

- If connection fails, see **`get_setup_instructions`** in MCP and `AGENTS.md` (bridge plugin, port, restart Cursor after MCP config changes).

## 3. Connect to MySQL in the UI

Until you connect, the welcome screen shows **“No active connection”** and the object browser has no databases. You must actually **open the connection dialog and press Connect** (saved profiles are listed there even when the sidebar looks empty).

1. Click **+ New Connection** on the welcome card, or **New Connection** in the top tab bar (plus icon).
2. The **Connection Manager** dialog opens. Under **Profiles**, click the saved profile you want (for example **local - passwordless** with host `127.0.0.1`).
3. In the dialog footer, click **Connect** (not only **Save** — **Connect** opens the live MySQL session and loads the object browser).
4. Wait until the sidebar tree lists databases and the tab shows **connected** status.

_Sample run (2026-03-31): After **Connect**, `pi_management` appeared in the tree; `permissions` opened via double-click under **Tables**._

## 4. Open `permissions` in table view

1. In the **object browser** (`data-testid="object-browser"`), expand the server node, then database **`pi_management`**, then the **Tables** category.
2. Optional: use **Filter objects** (`data-testid="filter-input"`) — e.g. type `permissions` to narrow the tree.
3. **Double-click** the **`permissions`** table row.
   - Table data is opened by **double-click** on a table (not only from the context menu).
   - Tree nodes expose `data-testid="tree-node-<nodeId>"` if you automate by test id.

## 5. Grid view: add and save a row

1. Ensure **grid** mode: toolbar button **`btn-grid-view`** (title: “Grid view”).
2. Click **Add** — `data-testid="btn-add-row"` (disabled if read-only, loading, or already editing a new row).
3. Fill required columns on the **new row** (last data row). Use **unique** `name` / `key` values if the table enforces uniqueness.
4. Click **Save** — `data-testid="btn-save"`.
5. **Success:** toast “Row saved” / “Changes saved successfully.” (toasts are **short-lived** — see § Logs below.)
6. **Failure:** toast “Save failed”, **Unsaved Changes** dialog with an error line, or the row stays dirty — see §7–8 and **§10**.

### 5a. MCP / automation notes (table grid)

The table workspace uses **React Data Grid** in the running app. The scroll viewport is exposed as **`data-testid="table-data-grid-inner"`** (outer wrapper is `table-data-grid`).

- **Rows:** under that node, select `[role="row"]` nodes that are **not** the header row (`rdg-header-row`). The **last** such row is typically the new row after **Add**.
- **Cells:** within that row, `[role="gridcell"]` in order: **`__pk`**, **`name`**, **`key`**, **`controller`**, **`method`**, then timestamp columns (exact list depends on the table).
- **Opening an editor:** prefer a **single click** on the target cell. The current RDG integration enables editing from the custom `onCellClick` handler, so double-click is unnecessary and can be flaky on narrower temporal cells (the second click may land on the inline `NULL` / calendar controls after the editor mounts). Accessibility tree **`ref=e…`** ids **expire** after DOM updates — prefer **CSS `data-testid`** or **computed x/y**, not stale refs.
- **Typing into RDG’s `<input>`:** plain `input.value = …` often **does not** update React state. Use the **native value setter**, then dispatch **`input`** (see snippet in **§10**).
- **`Tab`** from MCP may move focus to a non-input node; if so, **single-click** the next cell by coordinates and repeat.

## 6. Form view: add and save a row

1. Click **form** mode — `data-testid="btn-form-view"` (title: “Form view”).
2. Click **Add** — `btn-add-row` (same as grid; disabled while another new row is in progress).
3. **Nullable fields in NULL mode:** for a new row, **name** / **key** (and sometimes timestamps) may start as **NULL** with the **NULL** toggle active. Click the **`NULL`** button next to the field to **turn NULL off** (toggle to empty / editable text) **before** typing — e.g. **`btn-form-null-name`**, **`btn-form-null-key`**. _Without this step, typing may not register as intended._
4. Fill **`form-input-name`**, **`form-input-key`**, **`form-input-controller`**, **`form-input-method`** (and other required columns). Optional: `form-field-<column>` wraps each field.
5. Save with **`btn-form-save`** (“Save Changes”), or toolbar **`btn-save`** if that is what’s enabled.
6. Same success/failure behavior as grid (toasts + possible dialogs).

### 6a. MCP / automation notes (form)

Use stable selectors:

| Purpose                      | `data-testid`                        |
| ---------------------------- | ------------------------------------ |
| Form root                    | `table-data-form-view`               |
| Record nav                   | `form-record-nav`                    |
| Previous / Next record       | `btn-form-previous`, `btn-form-next` |
| NULL toggle for column `foo` | `btn-form-null-foo`                  |
| Text input for column `foo`  | `form-input-foo`                     |
| Form discard / save          | `btn-form-discard`, `btn-form-save`  |

**`webview_keyboard`** `type` with `selector: "[data-testid=\"form-input-name\"]"` / `strategy: "css"` has been verified to work after NULL is cleared.

## 7. Check the webview console (JS / React)

With an active **`driver_session`**, use MCP **`read_logs`**:

```json
{ "source": "console", "lines": 80 }
```

Optional: pass `"filter": "error"` (or a substring) to narrow output.

- Pull logs **soon after** Save or a failure — errors may also appear as **`console.error`** / **`console.warn`** from the frontend (e.g. `[module]` prefixes per project conventions).
- **Transient toasts:** if a save error only flashes in the UI, the **toast text may not persist**; rely on **`read_logs` → console**, on **in-app alerts** (accessibility snapshot may show an `alert` region), and on table UI state (dirty row, **Unsaved Changes** dialog).
- You may see **`[MCP][BRIDGE][UNHANDLED_REJECTION] Converting circular structure to JSON`** from the bridge when some objects are logged — treat as **MCP noise** unless it correlates with a reproducible app bug.

## 8. Backend / system logs if something fails

| Channel                            | How                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tauri / Rust**                   | Watch the **terminal** where `pnpm tauri dev` is running (`tracing` / stderr).                                                                                                  |
| **Application log file (on disk)** | Rolling **daily** files under **`{app_data_dir}/logs/`** — see below. Same `tracing` output as stderr; use this when the terminal scrolls away or you need a persistent record. |
| **MCP `read_logs` → `system`**     | On **macOS** this may use `log show`. On **Windows**, the same call may **fail** (`log` not found) — use the dev terminal and the **on-disk log** instead.                      |
| **IPC debugging**                  | `ipc_monitor` / `ipc_get_captured` (if enabled in your MCP setup) for invoke traffic.                                                                                           |

### Application log file location

The Rust backend writes to **`app.path().app_data_dir()`** + **`logs/`**, with file names shaped like **`mysql-client.YYYY-MM-DD.log`** (one file per local calendar day; see `src-tauri/src/lib.rs` setup and `src-tauri/src/logging/mod.rs`). The Tauri bundle identifier is **`io.mysqlclient.app`** (`tauri.conf.json`), which determines **`app_data_dir`**:

| OS          | Typical `app_data_dir`                                  | Log directory                        | Today’s file (example)        |
| ----------- | ------------------------------------------------------- | ------------------------------------ | ----------------------------- |
| **Windows** | `%APPDATA%\io.mysqlclient.app`                          | `%APPDATA%\io.mysqlclient.app\logs\` | `mysql-client.2026-03-31.log` |
| **macOS**   | `~/Library/Application Support/io.mysqlclient.app`      | `…/io.mysqlclient.app/logs/`         | same pattern                  |
| **Linux**   | `~/.local/share/io.mysqlclient.app` (typical for Tauri) | `…/io.mysqlclient.app/logs/`         | same pattern                  |

**During MCP runs:** after each step (navigation, save, dialog), **re-read the tail** of today’s log (or keep **`tail -f`** / **`Get-Content … -Wait`** open) and confirm no new **`ERROR`** lines (and review **`WARN`** if anything looked wrong in the UI). Old days’ files may remain until pruned by the app’s retention logic — always prefer the **current date**’s file for the session you are testing.

The MCP tool **`ipc_execute_command`** only supports a **subset** of Tauri commands; do not assume `list_connections` and similar are exposed — use the UI or the dev terminal for full backend behavior.

## 9. Optional selectors for automation

| Action                        | `data-testid`           |
| ----------------------------- | ----------------------- |
| Grid view                     | `btn-grid-view`         |
| Form view                     | `btn-form-view`         |
| Table data grid (outer)       | `table-data-grid`       |
| Table data grid (inner / RDG) | `table-data-grid-inner` |
| Add row                       | `btn-add-row`           |
| Save (toolbar)                | `btn-save`              |
| Save (form)                   | `btn-form-save`         |
| Discard (toolbar)             | `btn-discard`           |
| Refresh data                  | `btn-refresh`           |
| Read-only connection          | `readonly-badge`        |
| Table without PK              | `nopk-badge`            |
| Object browser                | `object-browser`        |
| Filter objects                | `filter-input`          |

## 10. Sample run log (2026-03-31) — `pi_management.permissions`

| Step                                                                                                   | Result                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `driver_session` on `9223`                                                                             | OK                                                                                                                 |
| Connect via Connection Manager → **Connect**                                                           | OK; **`pi_management`** → **Tables** → double-click **`permissions`**                                              |
| **Grid:** Add → fill **name / key / controller / method** (RDG + native input setter) → **`btn-save`** | **Unsaved Changes** dialog: **`Expected 1 row affected, got 0`** — treat as failed insert/update from DB/app layer |
| **Form:** Add → **`btn-form-null-name`** + **`btn-form-null-key`** → fill fields → **`btn-form-save`** | In-app **Save failed**: **`LAST_INSERT_ID`** decode — **`BIGINT UNSIGNED`** vs Rust **`i64`**                      |
| **`read_logs` `console`**                                                                              | Mostly bridge + React DevTools; optional **`UNHANDLED_REJECTION`… circular structure** from MCP bridge             |
| **`read_logs` `system`**                                                                               | **Windows:** may fail (`log` missing); use **`pnpm tauri dev`** terminal for Rust                                  |
| **On-disk `logs/mysql-client.*.log`**                                                                  | Check tail after each interaction for **`ERROR`** / unexpected **`WARN`** (see §8)                                 |

### RDG cell edit helper (run in `webview_execute_js` after focus is in the cell’s `<input>`)

After **single-clicking the target cell** so `document.activeElement` is the cell text input:

```javascript
;(() => {
  const el = document.activeElement
  if (!el || el.tagName !== 'INPUT') {
    return 'no-input'
  }
  const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  desc?.set?.call(el, 'your_text_here')
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
  return 'ok'
})()
```

Repeat per column (e.g. **name** → **key** → **controller** → **method**), then click **`btn-save`**.

## 11. Tear down

- **`driver_session`** with `action: "stop"` when finished (optionally with `appIdentifier` if multiple apps are attached).

---

_Re-run from §1 whenever you need to validate table-data insert/save behavior through the real app + MCP._
