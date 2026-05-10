# Query Result Grid macOS Performance Investigation Handoff

## Problem Statement

There is a severe macOS-only performance issue in the query editor tab when the query result is shown in **Grid** view.

Observed symptoms:

- Arrow-key navigation in the query result grid lags badly.
- Monaco editor input and selection feel sluggish while the grid is visible.
- Scrolling the query result grid is laggy.
- The entire tab feels slow while the query result grid is mounted.
- The same result shown in `Text` or `Form` view is smooth.
- The standalone full table view using `TableDataGrid` is smooth.
- The issue appears specific to the query-result grid path.

## User-Confirmed Repro Facts

- macOS only.
- Grid view only.
- Any other result view is smooth.
- A plain non-RDG renderer for query results was "butter smooth".
- The full table grid view, which also uses `react-data-grid`, is smooth.
- Therefore the strongest constraint is:

`TableDataGrid + RDG` is fine on macOS.

`ResultGridView + RDG` is slow on macOS.

`ResultGridView + plain renderer` is fine on macOS.

This strongly suggests we are missing a meaningful difference between the query-result grid path and the table-data grid path.

## Branch / Working Context

- Branch used throughout investigation: `codex/fix-query-result-grid-lag`
- Workspace path:
  `C:\Users\Omega\.codex\worktrees\5183\mysql-client`

## High-Level Conclusion So Far

The app's own measured JS work is usually cheap during the slowdown. The dominant telemetry signal is repeated `main-thread-delay` while the query-result RDG is mounted on macOS.

This means:

- It is probably not ordinary React render cost.
- It is probably not Monaco event handler cost.
- It is probably not obvious Zustand/store churn.
- It is probably not simple query-result row materialization cost.
- It is probably not one of the first several query-result-only behaviors that were disabled during diagnosis.

However, because `TableDataGrid` is smooth, the issue still does **not** look like "RDG is universally broken on macOS". It looks more like:

`react-data-grid + query-result path characteristics + macOS/WebKit/WKWebView`

## Instrumentation Added During Investigation

### Frontend Perf Logger

Added logging around query-result grid and Monaco/editor work:

- `src/lib/grid-performance-logger.ts`
- `src/components/query-editor/ResultGridView.tsx`
- `src/components/shared/BaseGridView.tsx`
- `src/components/query-editor/MonacoEditorWrapper.tsx`
- related prop plumbing in `src/types/shared-data-view.ts`

Relevant log prefixes:

- `[perf][query-result-grid]`
- `[perf][query-editor]`
- `[query-result-grid-debug]`

### What the Logs Showed

Representative macOS signals:

- `editor-render-commit`: low, usually single-digit to teens of ms
- `editor-model-content-handler`: ~0-1ms
- `result-render-commit`: low, usually single-digit to teens of ms
- `base-render-commit`: low, usually single-digit to teens of ms
- `result-row-materialize`: ~0-1ms
- `result-column-resolve`: ~0ms
- `rdg-cell-keydown`: ~0ms
- `rdg-scroll`: ~0ms
- `rdg-selected-cell-change`: ~0-1ms
- `main-thread-delay`: large on macOS, e.g. ~116ms, ~133ms, ~195ms, ~231ms, ~481ms

Interpretation:

- Input is arriving.
- Our measured handlers are cheap.
- The main thread is still stalling hard while the query-result grid is mounted.

## Experiments Already Tried

The list below is in rough chronological order, from earlier simpler fixes to deeper diagnostics.

### 1. Remove read-only keyboard-selection React churn

Goal:

- Avoid per-arrow-key React state work for row highlighting in read-only query results.

Changes:

- Moved selected-row highlighting toward the shared grid layer.
- Reduced React-state churn for read-only keyboard movement.

Result:

- Did not fix the real macOS slowdown.

What it ruled out:

- Basic query-result keyboard-selection state churn was not the primary root cause.

### 2. Debounce Monaco CodeLens refresh / avoid unchanged selectedText writes

Goal:

- Reduce editor-side overhead that might be amplified while the result grid is mounted.

Changes:

- Debounced/coalesced CodeLens refresh.
- Avoided unnecessary `selectedText` store rewrites.

Result:

- Did not fix the real issue.

What it ruled out:

- Obvious Monaco content-change overhead was not the main cause.

### 3. Grid containment / isolate mounted result subtree

Goal:

- Prevent the mounted result grid subtree from disturbing Monaco/editor layout/paint work.

Changes:

- Added grid-only containment boundary in `ResultPanel`.

Result:

- No material improvement.

What it ruled out:

- Simple containment around the query result pane was not enough.

### 4. Disable RDG `content-visibility` optimization

Goal:

- Test whether RDG/WebKit disliked `content-visibility: auto`.

Changes:

- Disabled root `content-visibility` optimization for the precision grid theme.

Result:

- No fix.

What it ruled out:

- That specific RDG content-visibility optimization was not the main trigger.

### 5. Perf instrumentation pass

Goal:

- Determine whether time was being spent in our JS logic or somewhere deeper.

Changes:

- Added app-log performance diagnostics for query-result grid and Monaco/editor.

Result:

- Very important finding:
  measured JS work stayed cheap while main-thread stalls stayed large.

What it ruled out:

- Many obvious app-level JS hotspots.

### 6. Parity-lite query-result diagnostic

Goal:

- Disable several query-result-only extras without replacing RDG.

Changes included disabling/bypassing:

- read-only selection sync
- imperative selected-row highlight path
- query-result column-resolution extras

Debug mode log:

- `[query-result-grid-debug] mode=parity-lite ...`

Result:

- Still slow.

What it ruled out:

- Those query-result-only behaviors were not the main cause.

### 7. Plain query-result renderer diagnostic

Goal:

- Prove whether the problem was tied to RDG rendering vs. the broader query-editor shell.

Changes:

- Added a simple plain renderer in `ResultPanel` for query results.
- Could be forced via:
  `localStorage['sqllumen.queryResultRenderer'] = 'plain'`

Debug mode log:

- `[query-result-grid-debug] mode="plain" ...`

Result:

- User reported it was "butter smooth" on macOS.

What it proved:

- The query editor split-pane shell alone is not the problem.
- Query results can be smooth in the same tab if RDG is removed.

What it did **not** prove:

- It did **not** prove that RDG is globally broken on macOS, because `TableDataGrid` is still smooth.

### 8. Native-key diagnostic

Goal:

- Remove the query-result `col_N` translation layer and use real column-name keys.

Changes:

- Query-result rows keyed by actual column names in the macOS read-only diagnostic path.

Debug mode log:

- Earlier mode variants around native keys.

Result:

- No fix.

What it ruled out:

- The `col_N` key translation layer was not the primary cause.

### 9. Disable read-only cell styling

Goal:

- Check whether the query-result read-only styling path caused WebKit trouble.

Changes:

- `applyReadOnlyCellStyles={false}` in the diagnostic path.

Result:

- No fix.

What it ruled out:

- Read-only cell styling alone was not the trigger.

### 10. Emulate editable descriptor path

Goal:

- Make the query-result RDG path more like table-data's editable descriptor path while still preventing writes.

Changes:

- Query-result read-only columns emulate the editable descriptor setup.

Result:

- No fix.

What it ruled out:

- The simpler descriptor difference was not enough to explain the slowdown.

### 11. Minimal RDG query-result path

Goal:

- Strip the macOS query-result grid toward bare RDG.

Changes:

- native keys
- no read-only cell styles
- no auto-size
- no custom cell renderer
- no custom sort-status renderer

Result:

- Still slow.

What it ruled out:

- Several higher-level grid features were not the root cause.

### 12. Table-data-shape diagnostic

Goal:

- Make `ResultGridView` render through a path shaped as closely as possible to `TableDataGrid`.

Changes:

- real column-name keys
- `__rowIndex` row identity
- column descriptors built via `buildColumnDescriptors(...)`
- table-data-like row selection and row class usage
- restored custom renderer, sort renderer, and auto-size
- selected-row props reduced/bypassed so behavior aligns more closely with table-data

Debug mode log:

- `[query-result-grid-debug] mode=table-data-shape ...`

Current status:

- User tested it and reported it still did not fix the issue.

What it ruled out:

- Even a much closer `TableDataGrid` shape was not enough, at least in the current approximation.

## Files Touched During Investigation

Most relevant files:

- `src/components/query-editor/ResultGridView.tsx`
- `src/components/query-editor/ResultPanel.tsx`
- `src/components/query-editor/ResultPanel.module.css`
- `src/components/query-editor/MonacoEditorWrapper.tsx`
- `src/components/shared/BaseGridView.tsx`
- `src/components/shared/DataGrid.tsx`
- `src/types/shared-data-view.ts`
- `src/styles/data-grid-precision.css`
- `src/lib/grid-performance-logger.ts`

Related tests:

- `src/tests/components/query-editor/ResultGridView.test.tsx`
- `src/tests/components/query-editor/ResultGridView.edit.test.tsx`
- `src/tests/components/query-editor/ResultPanel.test.tsx`
- `src/tests/components/query-editor/ResultPanel-layout.test.ts`
- `src/tests/components/query-editor/ResultPanel.edit.test.tsx`
- `src/tests/components/query-editor/ResultPanel.focus-loss.test.tsx`
- `src/tests/components/query-editor/MonacoEditorWrapper.test.tsx`
- `src/tests/styles/data-grid-precision.test.ts`

## Strongest Things We Have Ruled Out

The following are unlikely to be the primary cause:

- ordinary query-result keyboard-selection state churn
- Monaco CodeLens refresh / selectedText churn
- simple result-pane containment
- RDG root `content-visibility` optimization
- query-result selection-sync logic
- imperative selected-row highlight path
- query-result column-resolution extras
- `col_N` key translation
- query-result read-only cell styling
- custom sort-status renderer
- custom cell renderer
- auto-size by itself
- obvious JS render/handler cost in the app

## Most Important Constraint Still Standing

We still have this unresolved contradiction:

- `TableDataGrid` using RDG is fine on macOS.
- `ResultGridView` using RDG is slow on macOS.

That means the remaining issue is likely one of:

1. A still-unidentified structural difference between the query-result and table-data RDG usage paths.
2. A data-shape/layout interaction that happens much more often in query results.
3. A query-editor container + RDG interaction that the standalone table-data tab avoids.
4. A lower-level WebKit/WKWebView rendering/compositing path triggered specifically by query-result conditions.

## Current Best Hypotheses

These are the best remaining hypotheses to investigate:

### Hypothesis A: Wide query-result shape is the true trigger

The strongest reproduced slow case was around:

- `500 rows x 41 columns`

This may hit RDG layout/virtualization/header behavior differently than common table-data scenarios.

What to test:

- Compare table-data and query-result performance with matched width/column counts.
- Create an artificial table-data view with a similarly wide shape.
- Create a narrow query result and a wide query result under otherwise identical conditions.

### Hypothesis B: Query editor split-pane layout still matters, but only when RDG is present

Plain renderer in the query-editor tab is smooth, so the split alone is not enough.
But RDG inside that split may still trigger a compositor/layout path that table-data avoids.

What to test:

- Render the same RDG configuration outside the query-editor split but with query-result data.
- Render `TableDataGrid` inside the query-editor split as a temporary experiment.
- Compare pane sizing / sticky header / scroll container nesting between query editor and table-data tab.

### Hypothesis C: We still have not matched `TableDataGrid` closely enough

Even the table-data-shape diagnostic may still differ in ways that matter.

Possible remaining differences:

- hidden BaseGridView branches
- edit-mode vs read-only mode semantics inside RDG internals
- row key/getRowClass behavior details
- header/read-only flags
- focus/selection wiring
- surrounding wrapper CSS
- scroll container structure
- parent sizing / resize observer / panel interaction

What to test:

- Make a true temporary adapter that renders query-result data through `TableDataGrid` itself if possible.
- Alternatively build a `QueryResultViaTableDataGrid` shim that reuses the exact `TableDataGrid` component contract as much as possible.

### Hypothesis D: One specific CSS/layout difference still remains

Even if the JS path is close, CSS or container differences may still be the trigger.

What to compare directly:

- `ResultPanel` / query-editor grid wrapper CSS
- table-data tab wrapper CSS
- scroll region nesting
- sticky header usage
- height constraints
- overflow/contain rules
- precision grid theme classes

## Recommended Next Steps For The Next Agent

The next agent should avoid repeating already-ruled-out micro-toggles and instead focus on **direct structural comparison**.

Recommended order:

### 1. Diff `TableDataGrid` vs `ResultGridView` aggressively

Do a deep comparison of:

- `src/components/table-data/TableDataGrid.tsx`
- `src/components/query-editor/ResultGridView.tsx`
- `src/components/shared/BaseGridView.tsx`
- `src/components/shared/DataGrid.tsx`
- surrounding container components / CSS

Goal:

- identify any still-meaningful differences that survived the table-data-shape experiment

### 2. Try routing query results through the actual `TableDataGrid` component path

This is the highest-value remaining experiment.

If feasible:

- build a temporary adapter layer that feeds query-result data into `TableDataGrid`
- keep it read-only at the behavior level
- mount it inside the query-editor result pane

If that is smooth:

- the missing issue is inside `ResultGridView` / its adaptation layer

If that is still slow:

- the missing issue is probably in container/layout context, not grid adaptation alone

### 3. Compare matched data shapes

Create a controlled comparison:

- table-data view with a very wide dataset
- query-result view with the same shape if possible

Goal:

- determine whether width/column count is a hidden differentiator

### 4. Compare wrapper/layout/CSS directly

Inspect:

- panel structure
- overflow regions
- sticky header use
- container sizing
- precision theme classes
- any macOS-specific behavior in WebKit

### 5. Keep existing perf logs, but do not add broad new logging by default

Current logs already established the important thing:

- JS is cheap
- main-thread delay is expensive

Only add new logs if there is one very specific ambiguity to resolve.

## Current Diagnostic Modes / Helpful Signals

Useful debug logs to look for:

- `[perf][query-result-grid]`
- `[perf][query-editor]`
- `[query-result-grid-debug]`

Important mode values encountered during investigation:

- `plain`
- `parity-lite`
- `table-data-shape`

Important metric to watch:

- `main-thread-delay`

Low values in everything else paired with high `main-thread-delay` are consistent with the established pattern.

## Cleanup Note

This investigation added debug-only logging and diagnostics that should eventually be removed or cleaned up once the issue is solved.

Known debug-heavy areas:

- `src/lib/grid-performance-logger.ts`
- perf logger wiring in `ResultGridView.tsx`
- perf logger wiring in `BaseGridView.tsx`
- perf logger wiring in `MonacoEditorWrapper.tsx`
- debug-mode conditionals and logs in `ResultGridView.tsx`
- any temporary plain-renderer or diagnostic-mode code in `ResultPanel.tsx`

Before cleanup, preserve:

- the final understanding of root cause
- any regression test that captures the actual fix

## Practical Advice For The Next Agent

- Do not restart from generic "make RDG faster" assumptions.
- Treat the `TableDataGrid` vs `ResultGridView` difference as the key clue.
- Prefer decisive structural experiments over more micro-optimizations.
- If a temporary adapter to the exact `TableDataGrid` path is feasible, prioritize it.
- Keep the user-facing goal in mind:
  the user mainly wants query-result grid performance on macOS to match the smoothness of the table-data grid.

---

## Session 2: Container/Layout Hypothesis Experiments

### Deep Structural Diff Summary

A thorough comparison of `TableDataGrid` vs `ResultGridView` with all intermediate layers confirmed that the table-data-shape diagnostic (experiment #12) successfully matched nearly all JS-level props. The **remaining differences are all at the container/CSS/layout level:**

1. **Resizable split-pane context:** Query result grid lives inside `react-resizable-panels` `<Group orientation="vertical">` with Monaco editor as a sibling panel. TableDataGrid does NOT live in a resizable split — it's in a simple flex container.

2. **CSS containment:** Result grid wrapper `.gridTabPanel` applies `contain: layout paint style; isolation: isolate`. TableData has no containment.

3. **Extra wrapper nesting:** Result path has `ResultPanel .container` → `.tabPanel.gridTabPanel` → grid. TableData has `TableDataTab .content` → grid. Result adds `min-height: 0` on the tab panel; TableData uses `position: relative` on its content wrapper.

4. **Toolbar placement:** In Result, `ResultToolbar` is INSIDE the contained `.gridTabPanel` wrapper. In TableData, the toolbar is OUTSIDE the `.content` wrapper. This means toolbar changes share containment with the grid in Result path.

5. **Monaco co-existence:** The query editor tab always has a mounted Monaco editor above the result panel, sharing the same viewport. TableDataTab has no Monaco instance.

### Experiment 13: Layout diagnostic modes

Goal: Determine whether the `react-resizable-panels` split or Monaco co-existence triggers the WebKit/macOS main-thread stall.

Changes:

- Added `QueryEditorTab.tsx` diagnostic layout modes via `localStorage['sqllumen.queryEditorLayout']`:
  - `'stacked'` — replaces `react-resizable-panels` with plain CSS flex stacking (60%/40% split via flex-basis). Monaco is still mounted above the grid.
  - `'no-editor'` — hides Monaco entirely, result panel fills the content area alone.
- Added CSS classes in `QueryEditorTab.module.css`: `.diagnosticStacked`, `.diagnosticEditorHalf`, `.diagnosticResultHalf`, `.diagnosticResultOnly`.
- Diagnostic mode logged via `[query-editor-layout-diagnostic]` prefix.

How to test on macOS:

```js
// In browser console / Tauri devtools:

// Test 1: stacked layout (no resizable panels, Monaco still present)
localStorage.setItem('sqllumen.queryEditorLayout', 'stacked')
location.reload()

// Test 2: no editor (Monaco hidden, only result panel)
localStorage.setItem('sqllumen.queryEditorLayout', 'no-editor')
location.reload()

// Restore normal layout
localStorage.removeItem('sqllumen.queryEditorLayout')
location.reload()
```

Expected outcomes:

- If **stacked** is smooth → `react-resizable-panels` is the trigger. Fix: replace the resizable split with CSS-only layout for the query editor, or investigate panel library resize observer interaction with RDG.
- If **stacked** is still slow but **no-editor** is smooth → Monaco co-existence is the trigger. Fix: investigate Monaco DOM/paint interaction with RDG (e.g., offscreen Monaco, `visibility: hidden`, or lazy unmount).
- If **both** are still slow → the issue is in ResultPanel/ResultGridView container CSS or something else below the layout level.

Current status: **awaiting macOS user testing.**

### Experiment 14: CSS containment toggle

Goal: Test whether the `.gridTabPanel` containment/isolation CSS hurts or helps.

Changes:

- Added `localStorage['sqllumen.queryResultNoContain'] = 'true'` flag in `ResultPanel.tsx`.
- When enabled, the `.gridTabPanel` class (which adds `contain: layout paint style; isolation: isolate`) is not applied.

How to test:

```js
// Remove containment
localStorage.setItem('sqllumen.queryResultNoContain', 'true')
location.reload()

// Restore containment
localStorage.removeItem('sqllumen.queryResultNoContain')
location.reload()
```

Current status: **awaiting macOS user testing.**

### Files Touched in Session 2

- `src/components/query-editor/QueryEditorTab.tsx` — layout diagnostic modes
- `src/components/query-editor/QueryEditorTab.module.css` — diagnostic CSS classes
- `src/components/query-editor/ResultPanel.tsx` — no-contain diagnostic flag
- `docs/query-result-grid-macos-handoff.md` — this section

### Updated Hypotheses After Session 2 Analysis

Based on the deep diff, the hypotheses have been refined:

**Hypothesis B (elevated priority): Resizable split-pane layout interaction with RDG + WebKit**

The `react-resizable-panels` library may:

- Trigger resize observer callbacks that cause RDG to re-measure/relayout
- Set dynamic CSS styles (flex-basis, etc.) that trigger WebKit compositor recomposition
- Interact badly with RDG's own internal resize observer on macOS/WebKit

This is testable via `sqllumen.queryEditorLayout = 'stacked'`.

**Hypothesis E (new): Monaco + RDG co-existence on macOS/WebKit**

Two heavy DOM subsystems (Monaco editor with its DOM, and RDG with its virtualized grid) sharing the same viewport may overwhelm WebKit's compositor:

- Monaco's cursor blink / selection decoration paints may cross compositor boundaries
- RDG's sticky headers + virtualized rows in the same paint context as Monaco may force full-viewport compositing passes

This is testable via `sqllumen.queryEditorLayout = 'no-editor'`.

**Hypothesis D (still valid): CSS containment is a net negative on WebKit**

The `.gridTabPanel` containment was added as experiment #3 and had "no material improvement". It could be neutral or actively harmful. Testing via `sqllumen.queryResultNoContain = 'true'`.

### Recommended Next Steps

1. **User tests the three new diagnostic modes on macOS.** The stacked vs no-editor comparison is the most informative — it isolates panels vs Monaco as the trigger.

2. If panels are the trigger: investigate `react-resizable-panels` resize observer behavior, or replace with CSS-only layout.

3. If Monaco co-existence is the trigger: investigate `will-change: transform` or `contain: strict` on the Monaco panel to isolate its compositing from the result panel, or use `content-visibility: auto` on Monaco when it's not focused.

4. If both diagnostic modes are smooth: the fix is likely combining both approaches (simpler layout + compositor isolation).

5. If neither helps: the issue is deeper in ResultPanel/ResultGridView adaptation and we should proceed with the `TableDataGrid` adapter experiment (routing query results through the actual TableDataGrid component).
