# SRD: Testing Combination Tree UI

## 1. Overview

A client-side single-page tool that generates and displays a hierarchical tree of all testing combinations derived from user-configurable dimensions (e.g., environment, platform, action). Users navigate the tree, manually mark leaf nodes with a test result status, add remarks, and export results to Excel.

No backend is required. All state is managed in-memory for the duration of the browser session.

---

## 2. Problem Statement

When validating a system across multiple axes (e.g., deployment environment, platform, HTTP action), the number of required test cases grows multiplicatively. Manually tracking which combinations have been tested, which passed, and which failed is error-prone. This tool provides a structured visual representation of all combinations and a consistent workflow for recording results.

---

## 3. Scope

**In scope:**
- Configurable N-dimensional cartesian product tree generation
- Two interactive views: collapsible list and top-down diagram
- Manual status marking per leaf node (or entire subtree)
- Per-leaf text remarks
- Per-dimension value filtering (applies to both views)
- Excel export with two sheets and color-coded cells

**Out of scope:**
- Test execution / automation (no run buttons)
- CI/CD integration
- Persistent storage (no save/load to disk or database)
- User authentication

---

## 4. Dimensions

Dimensions are fully user-configurable at runtime via the Dimensions modal. The default set is:

| Dimension    | Key        | Values                      | Tree Depth |
|--------------|------------|-----------------------------|------------|
| Testing Env  | `env`      | `local`, `remote`           | Level 1    |
| Platform     | `platform` | `native`, `docker`, `k8s`   | Level 2    |
| Action       | `action`   | `get`, `post`               | Level 3    |

**Default total combinations:** 2 × 3 × 2 = **12 leaf nodes**

---

## 5. Data Model

### 5.1 Dimension

```
{
  name:   string    // display name, e.g. "Testing Env"
  key:    string    // derived from name; used as filter key, e.g. "testing_env"
  values: string[]  // e.g. ["local", "remote"]
}
```

Keys are auto-derived on Apply: `name.toLowerCase().replace(/\s+/g, '_')`, with a numeric suffix appended to ensure uniqueness across dimensions.

### 5.2 Tree Node

```
{
  id:       string      // dot-joined path, e.g. "local.native.get"; root = "__root__"
  label:    string      // last path segment, e.g. "get"
  path:     string[]    // full path from root, e.g. ["local", "native", "get"]
  depth:    number      // 0 = root, 1..N = dimension levels
  children: TreeNode[]  // empty for leaves
  isLeaf:   boolean
  status:   "untested" | "running" | "pass" | "fail" | "skipped"
  remark:   string      // leaf only; free-text note; defaults to ""
}
```

### 5.3 Aggregate Status (internal nodes)

Internal node status is computed on demand from descendant leaves:

| Leaf statuses                    | Aggregate      |
|----------------------------------|----------------|
| All `untested`                   | `untested`     |
| All `pass`                       | `pass`         |
| All `fail`                       | `fail`         |
| All `skipped`                    | `skipped`      |
| Any `running`                    | `running`      |
| Any `fail` (mixed)               | `fail`         |
| Mixed (no fail, not all same)    | `partial`      |

### 5.4 Application State

```
{
  dimensions:    Dimension[]
  tree:          TreeNode          // root node
  nodes:         { [id]: TreeNode } // flat lookup map
  leaves:        TreeNode[]        // ordered list of all leaf nodes
  selectedId:    string | null     // currently selected leaf id
  expandedIds:   Set<string>       // ids of expanded internal nodes (list view)
  activeFilters: { [dimKey]: Set<string> } // active values per dimension
  viewMode:      "list" | "diagram"
}
```

---

## 6. Tree Generation

The tree is built by recursive cartesian product over `state.dimensions`:

```
recurse(depth, path):
  if depth == dimensions.length:
    return leaf node { id: path.join("."), status: "untested", remark: "" }

  dim = dimensions[depth]
  return internal node {
    id:       path.length ? path.join(".") : "__root__",
    children: dim.values.map(v => recurse(depth+1, [...path, v]))
  }
```

The result is a flat node map (`state.nodes`) and a flat leaves array (`state.leaves`) maintained alongside the root for O(1) lookup.

---

## 7. Views

### 7.1 List View

An expandable/collapsible indented tree rendered as DOM nodes.

| ID    | Requirement |
|-------|-------------|
| LV-01 | All internal nodes expanded by default |
| LV-02 | Click an internal node row or its toggle arrow to expand/collapse |
| LV-03 | Click a leaf node to select it and open the Detail Panel |
| LV-04 | Each row shows: indent guides, toggle arrow, status dot, label, badge |
| LV-05 | Internal nodes show a badge: `{fail}✗ {pass}✓` if any fail, else `{pass}/{total}` |
| LV-06 | Toolbar **Expand All** / **Collapse All** buttons apply to list view only |
| LV-07 | Right-click any row to open the context menu |
| LV-08 | Filter chips hide/show nodes; an internal node is hidden if all its leaves are filtered |

### 7.2 Diagram View (default)

A top-down tree rendered with pure CSS (`ul`/`li` flex layout and `::before`/`::after` connector lines). No SVG.

| ID    | Requirement |
|-------|-------------|
| DV-01 | **Default view on load** |
| DV-02 | Each node rendered as a box (`.td-box`) showing status dot, label, and badge |
| DV-03 | Leaf boxes have a colour-coded 4px left border per status |
| DV-04 | Internal boxes have a tinted background per status |
| DV-05 | Click a leaf box to select it and open the Detail Panel |
| DV-06 | Right-click any box to open the context menu |
| DV-07 | Leaf boxes show a blue indicator dot when a remark is present |
| DV-08 | Filter chips hide/show `li` elements; an internal `li` is hidden if all its leaf descendants are filtered |
| DV-09 | Connector lines are drawn with CSS pseudo-elements; outermost nodes suppress their outer shoulder half |

### 7.3 View Toggle

Toolbar buttons switch between List and Diagram. Expand / Collapse buttons are disabled in Diagram mode. Switching views preserves all data state (statuses, selections, filter state).

---

## 8. Status System

### 8.1 Status Values

| Status     | Meaning                                    | Colour token     |
|------------|--------------------------------------------|------------------|
| `untested` | Default; not yet assessed                  | `--c-untested`   |
| `pass`     | Test passed                                | `--c-pass`       |
| `fail`     | Test failed                                | `--c-fail`       |
| `skipped`  | Deliberately skipped                       | `--c-skipped`    |
| `running`  | In progress (reserved; not set by UI)      | `--c-running`    |
| `partial`  | Internal only; mixed descendant statuses   | `--c-partial`    |

### 8.2 Marking

Status can be changed via:
- **Detail Panel** action buttons (Pass / Fail / Skip / Reset) — applies to the selected leaf only
- **Context menu** (right-click on any node) — applies to all leaf descendants of the target node
- The Reset action restores status to `untested`

After any status change, the affected node's row/box and all its ancestors are re-rendered in place (no full rebuild).

---

## 9. Detail Panel

Appears on the right side of the workspace when a leaf node is selected.

| ID    | Requirement |
|-------|-------------|
| DP-01 | Shows breadcrumb path: `seg1 › seg2 › seg3` |
| DP-02 | Shows status badge (styled per status) |
| DP-03 | Shows meta cards — one per dimension, showing the dimension name and the node's value for that dimension |
| DP-04 | Action buttons: **✓ Pass**, **✗ Fail**, **⊘ Skip**, **↺ Reset** — the button matching the current status is disabled |
| DP-05 | Remark textarea — changes are reflected immediately in the diagram indicator dot |
| DP-06 | When no node is selected, shows an empty-state placeholder |

---

## 10. Filter Bar

Located below the toolbar. One group of chips per dimension; each chip represents one dimension value.

| ID    | Requirement |
|-------|-------------|
| FB-01 | All chips active by default |
| FB-02 | Clicking an active chip deactivates it (removes value from filter set) |
| FB-03 | Clicking an inactive chip reactivates it |
| FB-04 | A chip cannot be deactivated if it is the last active chip in its group (minimum 1 per dimension) |
| FB-05 | Filter changes apply immediately to both List and Diagram views |
| FB-06 | Filter bar resets to all-active when dimensions are rebuilt |

---

## 11. Context Menu

Right-click on any node in either view.

| Action    | Effect |
|-----------|--------|
| ✓ Mark Pass | Sets all descendant leaves to `pass` |
| ✗ Mark Fail | Sets all descendant leaves to `fail` |
| ⊘ Skip      | Sets all descendant leaves to `skipped` |
| ↺ Reset     | Sets all descendant leaves to `untested` |

The menu closes on action selection or on any click outside it.

---

## 12. Summary Bar

Fixed footer bar, always visible.

| ID    | Requirement |
|-------|-------------|
| SB-01 | Displays count chips: Total, Pass, Fail, Skipped, Untested — each with a colour dot |
| SB-02 | Displays a segmented progress bar: Pass (green) / Fail (red) / Skipped (yellow) segments |
| SB-03 | Displays overall completion percentage: `(pass + fail + skipped) / total × 100%` |
| SB-04 | Updates immediately after any status change |

---

## 13. Dimension Editor Modal

Opened via the **⚙ Dimensions** toolbar button.

| ID    | Requirement |
|-------|-------------|
| DE-01 | Opens a modal over a dark backdrop; Escape / backdrop click / ✕ closes without saving |
| DE-02 | Edits a deep clone of `state.dimensions`; Cancel discards all changes |
| DE-03 | Each dimension card has an editable name field and a row of value chips |
| DE-04 | Press Enter in the value input to add a value; duplicate values are rejected silently |
| DE-05 | Each value chip has a ✕ button; disabled when only 1 value remains |
| DE-06 | Each dimension card has a ✕ button to remove it; disabled when only 1 dimension remains |
| DE-07 | **+ Add Dimension** button appends a new card and focuses its name input |
| DE-08 | **Apply** validates that every dimension has a non-empty name, derives unique keys from names, saves to `state.dimensions`, and calls `rebuildAll()` |
| DE-09 | `rebuildAll()` regenerates the tree, resets all statuses to `untested`, resets filters, and re-renders all views without re-binding event listeners |

---

## 14. Excel Export

Triggered by the **⬇ Export** toolbar button. Uses the `xlsx-js-style` library (CDN). Produces a file named `test-combinations.xlsx` with two sheets.

### 14.1 List Sheet

One row per leaf, columns: one per dimension, Status, Remark.

- Column widths: 14ch per dimension, 12ch for Status, 36ch for Remark
- Status cells are colour-coded:

| Status     | Background | Font colour |
|------------|------------|-------------|
| `pass`     | `#C6EFCE`  | `#006100`   |
| `fail`     | `#FFC7CE`  | `#9C0006`   |
| `untested` | `#FFEB9C`  | `#9C5700`   |
| `skipped`  | `#FFD966`  | `#7F6000`   |

### 14.2 Tree Sheet

A top-down merged-cell layout mirroring the diagram view.

- One row per dimension level; one final row for remarks
- Each internal node spans its leftmost–rightmost leaf column via Excel merge
- Leaf cells (bottom dimension row) are colour-coded with the same palette as the List sheet
- Cell content format: `label (status)`

---

## 15. Toolbar Summary

| Button            | Action |
|-------------------|--------|
| ⚙ Dimensions      | Opens the Dimension Editor modal |
| ⬇ Export          | Exports current state to Excel |
| ⊞ Expand          | Expands all nodes (List view only) |
| ⊟ Collapse        | Collapses all non-root nodes (List view only) |
| ☰ List            | Switches to List view |
| ⊛ Diagram         | Switches to Diagram view (default) |

---

## 16. Non-Functional Requirements

| ID     | Requirement |
|--------|-------------|
| NFR-01 | No backend required; fully client-side (HTML + CSS + JS) |
| NFR-02 | No build step; served as static files directly from the filesystem or any HTTP server |
| NFR-03 | External dependencies: `xlsx-js-style` (CDN, Excel export only) |
| NFR-04 | Tree re-renders in-place on status change; no full DOM rebuild |
| NFR-05 | Dimension changes trigger a full rebuild but do not re-bind event listeners |
| NFR-06 | Minimum supported resolution: 1280 × 800 |

---

## 17. File Structure

```
index.html   — Shell: toolbar, filter bar, workspace, summary bar, context menu, CDN scripts
style.css    — All styles: layout, component themes, status colours, diagram connectors, modal
app.js       — All logic: state, tree builder, renderers, event handlers, export
```
