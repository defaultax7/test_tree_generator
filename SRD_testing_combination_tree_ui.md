# SRD: Testing Combination Tree UI

## 1. Overview

This document specifies requirements for a tool that generates and displays a hierarchical tree of all testing combinations derived from configurable dimensions (e.g., environment, platform, action). The UI renders this tree interactively, allowing users to explore, select, and execute test combinations.

---

## 2. Problem Statement

When testing systems across multiple dimensions (e.g., environment, deployment platform, HTTP method), the number of combinations grows multiplicatively. Manually tracking and running each combination is error-prone. This tool provides a structured, visual representation of all combinations and enables targeted execution.

---

## 3. Scope

- Accepts N dimensions, each with M possible values
- Generates all combinations (cartesian product)
- Renders combinations as an interactive tree in a UI
- Supports selection and execution of individual nodes or subtrees
- Reports pass/fail status per combination

Out of scope: test content/logic, CI/CD integration (v1).

---

## 4. Dimensions

Dimensions are user-configurable. The default set is:

| Dimension         | Values                  | Tree Depth |
|-------------------|-------------------------|------------|
| Testing Env       | `local`, `remote`       | Level 1    |
| Running Platform  | `native`, `docker`, `k8s` | Level 2  |
| Action            | `get`, `post`           | Level 3    |

**Total combinations:** 2 × 3 × 2 = **12 leaf nodes**

---

## 5. Combination Tree Structure

```
root
├── local
│   ├── native
│   │   ├── get
│   │   └── post
│   ├── docker
│   │   ├── get
│   │   └── post
│   └── k8s
│       ├── get
│       └── post
└── remote
    ├── native
    │   ├── get
    │   └── post
    ├── docker
    │   ├── get
    │   └── post
    └── k8s
        ├── get
        └── post
```

Each **leaf node** represents one fully-qualified test combination, e.g.:
- `local > native > get`
- `remote > k8s > post`

Each **internal node** represents a partial combination (a group of tests).

---

## 6. Data Model

### 6.1 Dimension Config

```ts
interface Dimension {
  name: string;       // e.g. "Testing Env"
  key: string;        // e.g. "env"
  values: string[];   // e.g. ["local", "remote"]
}
```

### 6.2 Tree Node

```ts
interface TreeNode {
  id: string;           // e.g. "local.native.get"
  label: string;        // e.g. "get"
  path: string[];       // e.g. ["local", "native", "get"]
  depth: number;        // 0 = root, 1..N = dimension levels
  children: TreeNode[];
  isLeaf: boolean;
  status: "idle" | "running" | "pass" | "fail" | "skipped";
}
```

### 6.3 Combination Record (leaf only)

```ts
interface Combination {
  id: string;
  env: string;          // "local" | "remote"
  platform: string;     // "native" | "docker" | "k8s"
  action: string;       // "get" | "post"
  status: CombinationStatus;
  startedAt?: Date;
  finishedAt?: Date;
  logs?: string;
}
```

---

## 7. UI Requirements

### 7.1 Tree Panel

| Requirement | Description |
|---|---|
| TR-01 | Render the full combination tree in an expandable/collapsible tree view |
| TR-02 | All nodes expanded by default |
| TR-03 | Internal nodes show child count badge (e.g., `native (2)`) |
| TR-04 | Leaf nodes display status indicator: idle / running / pass / fail / skipped |
| TR-05 | Internal nodes show aggregate status: pass if all children pass, fail if any child fails, partial otherwise |
| TR-06 | Clicking a leaf node selects it and shows details in the Detail Panel |
| TR-07 | Right-click context menu on any node: **Run**, **Run Subtree**, **Skip**, **Reset** |

### 7.2 Toolbar

| Requirement | Description |
|---|---|
| TB-01 | **Run All** button — runs all 12 combinations sequentially or in parallel (configurable) |
| TB-02 | **Run Selected** button — runs only checked/selected nodes |
| TB-03 | **Reset All** button — resets all statuses to idle |
| TB-04 | Filter chips per dimension value (e.g., toggle `local` off to hide its subtree) |
| TB-05 | **Expand All / Collapse All** toggle |

### 7.3 Detail Panel (right-side drawer or bottom panel)

| Requirement | Description |
|---|---|
| DP-01 | Shows full combination path for the selected leaf |
| DP-02 | Shows status, start time, duration |
| DP-03 | Shows log output (scrollable, monospace) |
| DP-04 | Shows **Re-run** and **Skip** action buttons |

### 7.4 Summary Bar

| Requirement | Description |
|---|---|
| SB-01 | Displays total counts: Total / Pass / Fail / Running / Skipped / Idle |
| SB-02 | Displays a progress bar (pass + fail / total) |
| SB-03 | Updates in real time as tests run |

---

## 8. Functional Requirements

| ID | Requirement |
|---|---|
| FR-01 | The tree is generated programmatically from the dimension config array (cartesian product) |
| FR-02 | Adding or removing a dimension value regenerates the tree without manual changes |
| FR-03 | The system must support at minimum N=5 dimensions and M=10 values per dimension |
| FR-04 | Each leaf node maps to a runnable test unit (stub, script, or API call) |
| FR-05 | Running a parent node runs all descendant leaf nodes |
| FR-06 | Parallel execution limit is configurable (default: 4 concurrent) |
| FR-07 | State is persisted in memory per session; optional export to JSON |
| FR-08 | Tree re-renders without full page reload when dimension config changes |

---

## 9. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-01 | Tree renders within 200ms for up to 500 leaf nodes |
| NFR-02 | UI is responsive and usable at 1280×800 minimum resolution |
| NFR-03 | Accessible: keyboard navigable tree, ARIA labels on status indicators |
| NFR-04 | No external backend required for v1 (client-side only) |

---

## 10. Tree Generation Algorithm

```
function buildTree(dimensions: Dimension[]): TreeNode {
  function recurse(depth, pathSoFar): TreeNode[] {
    if depth == dimensions.length:
      return [leaf node with id = pathSoFar.join(".")]

    return dimensions[depth].values.map(value => {
      children = recurse(depth + 1, [...pathSoFar, value])
      return internal node { label: value, children, depth }
    })
  }

  return { label: "root", depth: 0, children: recurse(0, []) }
}
```

---

## 11. Example Rendered Tree (with statuses)

```
root                          [partial: 8/12 pass]
├── local                     [partial: 5/6 pass]
│   ├── native                [pass: 2/2]
│   │   ├── get               [PASS]
│   │   └── post              [PASS]
│   ├── docker                [partial: 1/2]
│   │   ├── get               [PASS]
│   │   └── post              [FAIL]
│   └── k8s                   [pass: 2/2]
│       ├── get               [PASS]
│       └── post              [PASS]
└── remote                    [partial: 3/6 pass]
    ├── native                [pass: 2/2]
    │   ├── get               [PASS]
    │   └── post              [PASS]
    ├── docker                [fail: 0/2]
    │   ├── get               [FAIL]
    │   └── post              [FAIL]
    └── k8s                   [idle]
        ├── get               [IDLE]
        └── post              [IDLE]
```

---

## 12. Open Questions

| # | Question | Owner |
|---|---|---|
| Q1 | Should the tree order (which dimension is depth-1 vs depth-N) be user-configurable via drag-and-drop? | Product |
| Q2 | Should failed combinations auto-retry with a configurable retry count? | Product |
| Q3 | Is JSON export sufficient or is CSV/HTML report also needed? | Product |
| Q4 | Should dimension values support icons/colors for better visual grouping? | Design |
