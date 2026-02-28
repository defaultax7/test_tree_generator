/* ═══════════════════════════════════════════════════════════════════
   Test Combination Tree  — app.js
   ═══════════════════════════════════════════════════════════════════ */

/* ── 1. Dimension config (edit here to add/remove dimensions) ─────── */
const DIMENSIONS = [
  { name: 'Testing Env',      key: 'env',      values: ['local', 'remote'] },
  { name: 'Platform',         key: 'platform', values: ['native', 'docker', 'k8s'] },
  { name: 'Action',           key: 'action',   values: ['get', 'post'] },
];

/* ── 2. State ─────────────────────────────────────────────────────── */
const state = {
  tree:           null,   // root TreeNode
  nodes:          {},     // id -> TreeNode (flat map)
  leaves:         [],     // leaf TreeNode[] in insertion order
  selectedId:     null,   // currently selected leaf id
  checkedIds:     new Set(),
  expandedIds:    new Set(),
  activeFilters:  {},     // key -> Set<value>  (values that are VISIBLE)
  isRunning:      false,
  stopRequested:  false,
  concurrency:    4,
};

/* ── 3. Tree builder ──────────────────────────────────────────────── */
function buildTree() {
  const nodes = {};
  const leaves = [];

  function recurse(depth, path) {
    if (depth === DIMENSIONS.length) {
      const id = path.join('.');
      const node = {
        id, path: [...path], depth,
        label:    path[path.length - 1],
        children: [],
        isLeaf:   true,
        status:   'idle',
        startedAt: null, finishedAt: null, logs: '',
      };
      nodes[id] = node;
      leaves.push(node);
      return node;
    }
    const dim = DIMENSIONS[depth];
    const id  = path.length ? path.join('.') : '__root__';
    const node = {
      id, path: [...path], depth,
      label:    path.length ? path[path.length - 1] : 'root',
      children: dim.values.map(v => recurse(depth + 1, [...path, v])),
      isLeaf:   false,
      status:   'idle',
    };
    nodes[id] = node;
    return node;
  }

  const root = recurse(0, []);
  return { root, nodes, leaves };
}

/* ── 4. Status helpers ────────────────────────────────────────────── */
function getLeaves(node) {
  if (node.isLeaf) return [node];
  return node.children.flatMap(getLeaves);
}

function aggregateStatus(node) {
  if (node.isLeaf) return node.status;
  const statuses = getLeaves(node).map(l => l.status);
  if (statuses.every(s => s === 'idle'))    return 'idle';
  if (statuses.every(s => s === 'pass'))    return 'pass';
  if (statuses.every(s => s === 'skipped')) return 'skipped';
  if (statuses.every(s => s === 'fail'))    return 'fail';
  if (statuses.some(s => s === 'running'))  return 'running';
  if (statuses.some(s => s === 'fail'))     return 'fail';
  return 'partial';
}

function summaryCounts() {
  const counts = { total: state.leaves.length, idle: 0, running: 0, pass: 0, fail: 0, skipped: 0 };
  state.leaves.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });
  return counts;
}

/* ── 5. Mock runner ───────────────────────────────────────────────── */
const MOCK_LOG_LINES = {
  pass: [
    '→ Initialising test...',
    '→ Connecting to endpoint...',
    '✓ Connection established',
    '→ Sending request...',
    '✓ Response received (200 OK)',
    '✓ Assertions passed',
    '✓ PASS',
  ],
  fail: [
    '→ Initialising test...',
    '→ Connecting to endpoint...',
    '✓ Connection established',
    '→ Sending request...',
    '✗ Response: 500 Internal Server Error',
    '✗ Assertion failed: expected status 200, got 500',
    '✗ FAIL',
  ],
};

function mockRunLeaf(leaf) {
  return new Promise(resolve => {
    const delay   = 400 + Math.random() * 1400;   // 400ms – 1800ms
    const outcome = Math.random() < 0.75 ? 'pass' : 'fail';
    const lines   = MOCK_LOG_LINES[outcome];

    leaf.status    = 'running';
    leaf.startedAt = new Date();
    leaf.logs      = '';
    renderNode(leaf.id);
    updateDetail(leaf.id);
    updateSummary();

    /* stream log lines */
    const lineDelay = delay / (lines.length + 1);
    lines.forEach((line, i) => {
      setTimeout(() => {
        leaf.logs += (leaf.logs ? '\n' : '') + line;
        updateDetail(leaf.id);
      }, lineDelay * (i + 1));
    });

    setTimeout(() => {
      leaf.status     = outcome;
      leaf.finishedAt = new Date();
      renderNode(leaf.id);
      updateDetail(leaf.id);
      updateSummary();
      resolve(outcome);
    }, delay);
  });
}

async function runLeaves(leafNodes) {
  if (state.isRunning) return;
  state.isRunning     = true;
  state.stopRequested = false;
  el('btn-run-all').disabled      = true;
  el('btn-run-selected').disabled = true;
  el('btn-stop').disabled         = false;

  const queue = [...leafNodes];
  const limit = state.concurrency === 0 ? queue.length : state.concurrency;

  async function worker() {
    while (queue.length > 0 && !state.stopRequested) {
      const leaf = queue.shift();
      if (leaf.status === 'skipped') continue;
      await mockRunLeaf(leaf);
      /* re-render ancestors */
      renderAncestors(leaf);
    }
  }

  const workers = Array.from({ length: Math.min(limit, queue.length) }, worker);
  await Promise.all(workers);

  state.isRunning = false;
  el('btn-run-all').disabled      = false;
  el('btn-stop').disabled         = true;
  const hasSel = state.checkedIds.size > 0;
  el('btn-run-selected').disabled = !hasSel;
  updateSummary();
}

/* ── 6. DOM helpers ───────────────────────────────────────────────── */
const el   = id => document.getElementById(id);
const $    = (sel, ctx = document) => ctx.querySelector(sel);
const $$   = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function renderAncestors(leaf) {
  /* walk up the path and re-render each ancestor row */
  for (let d = 1; d < leaf.path.length; d++) {
    const anId = leaf.path.slice(0, d).join('.');
    if (anId) renderNode(anId);
  }
  renderNode('__root__');
}

/* ── 7. Filter helpers ────────────────────────────────────────────── */
function isNodeVisible(node) {
  /* a leaf is visible if every dimension value in its path passes the filter */
  if (!node.isLeaf) return true;
  return DIMENSIONS.every((dim, i) => {
    const val = node.path[i];
    return state.activeFilters[dim.key].has(val);
  });
}

function applyFilters() {
  state.leaves.forEach(leaf => {
    const rowEl = document.querySelector(`[data-node-id="${leaf.id}"]`);
    if (!rowEl) return;
    const nodeEl = rowEl.closest('.tree-node');
    if (!nodeEl) return;
    nodeEl.classList.toggle('filtered', !isNodeVisible(leaf));
  });
  /* show/hide internal nodes that have no visible children */
  $$('.tree-node[data-depth]').forEach(nodeEl => {
    const depth = parseInt(nodeEl.dataset.depth, 10);
    if (depth === DIMENSIONS.length) return;   // leaf
    const hasVisible = !!nodeEl.querySelector('.tree-node:not(.filtered)');
    nodeEl.classList.toggle('filtered', !hasVisible);
  });
}

/* ── 8. Render a single tree row ──────────────────────────────────── */
function renderNode(id) {
  const node    = state.nodes[id];
  if (!node) return;
  const rowEl   = document.querySelector(`[data-node-id="${id}"]`);
  if (!rowEl)   return;

  const status  = node.isLeaf ? node.status : aggregateStatus(node);
  const dotEl   = rowEl.querySelector('.status-dot');
  if (dotEl) { dotEl.className = `status-dot ${status}`; }

  const badgeEl = rowEl.querySelector('.node-badge');
  if (badgeEl && !node.isLeaf) {
    const leaves  = getLeaves(node);
    const pass    = leaves.filter(l => l.status === 'pass').length;
    const fail    = leaves.filter(l => l.status === 'fail').length;
    const total   = leaves.length;
    badgeEl.textContent = fail ? `${fail}✗ ${pass}✓` : `${pass}/${total}`;
    badgeEl.className   = `node-badge ${status}`;
  }
}

/* ── 9. Build full tree DOM ───────────────────────────────────────── */
function buildNodeEl(node) {
  const wrapper = document.createElement('div');
  wrapper.className     = 'tree-node';
  wrapper.dataset.depth = node.depth;

  /* indent guides */
  let indentHTML = '';
  for (let i = 0; i < node.depth; i++) {
    indentHTML += '<span class="tree-guide"></span>';
  }

  /* toggle arrow */
  const arrow = node.isLeaf ? '' : (state.expandedIds.has(node.id) ? '▾' : '▸');

  /* badge */
  const leaves   = node.isLeaf ? [node] : getLeaves(node);
  const badgeVal = node.isLeaf ? '' : `0/${leaves.length}`;
  const badgePart= node.isLeaf ? '' : `<span class="node-badge">${badgeVal}</span>`;

  wrapper.innerHTML = `
    <div class="tree-row" data-node-id="${node.id}" data-leaf="${node.isLeaf}">
      <span class="tree-indent">${indentHTML}</span>
      <span class="tree-toggle ${node.isLeaf ? 'leaf' : ''}" data-toggle="${node.id}">${arrow}</span>
      <input type="checkbox" class="tree-checkbox" data-check="${node.id}" />
      <span class="status-dot idle"></span>
      <span class="tree-label ${node.isLeaf ? 'leaf' : 'internal'}">${node.label}</span>
      ${badgePart}
    </div>`;

  if (!node.isLeaf) {
    const children = document.createElement('div');
    children.className = 'tree-children';
    if (!state.expandedIds.has(node.id)) children.classList.add('collapsed');
    node.children.forEach(child => children.appendChild(buildNodeEl(child)));
    wrapper.appendChild(children);
  }

  return wrapper;
}

function renderFullTree() {
  const container = el('tree-root');
  container.innerHTML = '';
  /* render each top-level child of root */
  state.tree.children.forEach(child => container.appendChild(buildNodeEl(child)));
}

/* ── 10. Detail panel ─────────────────────────────────────────────── */
function updateDetail(id) {
  if (state.selectedId !== id) return;
  const node = state.nodes[id];
  if (!node || !node.isLeaf) return;

  el('detail-empty').hidden   = true;
  el('detail-content').hidden = false;

  /* breadcrumb */
  el('detail-breadcrumb').innerHTML = node.path
    .map((seg, i) => `<span class="breadcrumb-seg">${seg}</span>${i < node.path.length-1 ? '<span class="breadcrumb-sep">›</span>' : ''}`)
    .join('');

  /* status badge */
  const badge = el('detail-status-badge');
  badge.textContent = node.status.toUpperCase();
  badge.className   = `status-badge ${node.status}`;

  /* meta cards */
  const dur = node.startedAt && node.finishedAt
    ? `${((node.finishedAt - node.startedAt)/1000).toFixed(2)}s`
    : node.startedAt ? 'running…' : '—';

  const metaData = [
    ...DIMENSIONS.map((dim, i) => ({ label: dim.name, val: node.path[i] })),
    { label: 'Started',  val: node.startedAt ? node.startedAt.toLocaleTimeString() : '—' },
    { label: 'Duration', val: dur },
  ];

  el('detail-meta').innerHTML = metaData
    .map(m => `<div class="meta-card">
      <div class="meta-card-label">${m.label}</div>
      <div class="meta-card-value">${m.val}</div>
    </div>`)
    .join('');

  /* log */
  el('detail-log').textContent = node.logs || '(no output)';
  el('detail-log').scrollTop   = el('detail-log').scrollHeight;

  /* buttons */
  el('btn-detail-run').disabled  = state.isRunning;
  el('btn-detail-skip').disabled = node.status === 'skipped';
  el('btn-detail-reset').disabled= false;
}

function showDetail(id) {
  state.selectedId = id;
  /* deselect previous */
  $$('.tree-row.selected').forEach(r => r.classList.remove('selected'));
  const row = document.querySelector(`[data-node-id="${id}"]`);
  if (row) row.classList.add('selected');
  updateDetail(id);
}

/* ── 11. Summary bar ──────────────────────────────────────────────── */
function updateSummary() {
  const c     = summaryCounts();
  const done  = c.pass + c.fail + c.skipped;
  const pct   = c.total ? Math.round((done / c.total) * 100) : 0;

  const countDefs = [
    { key: 'total',   label: 'total',   color: '#64748b' },
    { key: 'pass',    label: 'pass',    color: 'var(--c-pass)' },
    { key: 'fail',    label: 'fail',    color: 'var(--c-fail)' },
    { key: 'running', label: 'running', color: 'var(--c-running)' },
    { key: 'skipped', label: 'skipped', color: 'var(--c-skipped)' },
    { key: 'idle',    label: 'idle',    color: 'var(--c-idle)' },
  ];

  el('summary-counts').innerHTML = countDefs
    .map(d => `<span class="summary-count">
      <span class="summary-count-dot" style="background:${d.color}"></span>
      <span class="summary-count-val">${c[d.key]}</span>
      <span class="summary-count-lbl">${d.label}</span>
    </span>`)
    .join('');

  const pct2 = v => `${c.total ? ((v / c.total) * 100).toFixed(1) : 0}%`;
  el('prog-pass').style.width    = pct2(c.pass);
  el('prog-fail').style.width    = pct2(c.fail);
  el('prog-running').style.width = pct2(c.running);
  el('prog-skipped').style.width = pct2(c.skipped);
  el('summary-pct').textContent  = `${pct}%`;
}

/* ── 12. Filter bar ───────────────────────────────────────────────── */
function buildFilterBar() {
  el('filter-bar').innerHTML = DIMENSIONS.map(dim => `
    <div class="filter-group">
      <span class="filter-label">${dim.name}:</span>
      ${dim.values.map(val => `
        <span class="filter-chip active" data-filter-dim="${dim.key}" data-filter-val="${val}">${val}</span>
      `).join('')}
    </div>
  `).join('');

  $$('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const dim = chip.dataset.filterDim;
      const val = chip.dataset.filterVal;
      if (state.activeFilters[dim].has(val)) {
        /* don't allow deselecting all chips in a group */
        if (state.activeFilters[dim].size === 1) return;
        state.activeFilters[dim].delete(val);
        chip.classList.remove('active');
      } else {
        state.activeFilters[dim].add(val);
        chip.classList.add('active');
      }
      applyFilters();
    });
  });
}

/* ── 13. Context menu ─────────────────────────────────────────────── */
let ctxTargetId = null;

function showCtxMenu(x, y, nodeId) {
  ctxTargetId = nodeId;
  const menu  = el('ctx-menu');
  menu.hidden = false;
  menu.style.left = `${Math.min(x, window.innerWidth  - 180)}px`;
  menu.style.top  = `${Math.min(y, window.innerHeight - 150)}px`;
}

function hideCtxMenu() {
  el('ctx-menu').hidden = true;
  ctxTargetId = null;
}

/* ── 14. Run helpers ──────────────────────────────────────────────── */
function runNode(id) {
  const node = state.nodes[id];
  if (!node) return;
  const leavesToRun = getLeaves(node).filter(l => l.status !== 'skipped');
  runLeaves(leavesToRun);
}

function skipNode(id) {
  const node = state.nodes[id];
  if (!node) return;
  getLeaves(node).forEach(l => {
    l.status = 'skipped';
    renderNode(l.id);
    renderAncestors(l);
  });
  updateDetail(id);
  updateSummary();
}

function resetNode(id) {
  const node = state.nodes[id];
  if (!node) return;
  getLeaves(node).forEach(l => {
    l.status = 'idle';
    l.startedAt = null; l.finishedAt = null; l.logs = '';
    renderNode(l.id);
    renderAncestors(l);
  });
  updateDetail(id);
  updateSummary();
}

/* ── 15. Expand / collapse ────────────────────────────────────────── */
function setExpanded(id, expanded) {
  const row = document.querySelector(`[data-node-id="${id}"]`);
  if (!row) return;
  const childEl  = row.parentElement.querySelector('.tree-children');
  const toggleEl = row.querySelector(`[data-toggle="${id}"]`);
  if (childEl)  childEl.classList.toggle('collapsed', !expanded);
  if (toggleEl) toggleEl.textContent = expanded ? '▾' : '▸';
  if (expanded) state.expandedIds.add(id);
  else          state.expandedIds.delete(id);
}

function expandAll()   {
  Object.values(state.nodes).filter(n => !n.isLeaf).forEach(n => setExpanded(n.id, true));
}
function collapseAll() {
  Object.values(state.nodes).filter(n => !n.isLeaf && n.id !== '__root__').forEach(n => setExpanded(n.id, false));
}

/* ── 16. Checkbox helpers ─────────────────────────────────────────── */
function setChecked(id, checked) {
  const node = state.nodes[id];
  if (!node) return;
  /* check/uncheck all leaf descendants */
  getLeaves(node).forEach(l => {
    if (checked) state.checkedIds.add(l.id);
    else state.checkedIds.delete(l.id);
    const cb = document.querySelector(`[data-check="${l.id}"]`);
    if (cb) cb.checked = checked;
  });
  /* sync parent checkboxes */
  if (!node.isLeaf) {
    const cb = document.querySelector(`[data-check="${id}"]`);
    if (cb) cb.checked = checked;
  }
  el('btn-run-selected').disabled = state.checkedIds.size === 0;
}

/* ── 17. Init ─────────────────────────────────────────────────────── */
function init() {
  /* build data */
  const { root, nodes, leaves } = buildTree();
  state.tree   = root;
  state.nodes  = nodes;
  state.leaves = leaves;

  /* init filters — all values active */
  DIMENSIONS.forEach(dim => {
    state.activeFilters[dim.key] = new Set(dim.values);
  });

  /* init expanded state — expand all */
  Object.values(nodes).filter(n => !n.isLeaf).forEach(n => state.expandedIds.add(n.id));

  /* render */
  buildFilterBar();
  renderFullTree();
  updateSummary();

  /* ── Event: tree interactions ───────────────────────────────────── */
  el('tree-root').addEventListener('click', e => {
    const row  = e.target.closest('[data-node-id]');
    if (!row) return;
    const id   = row.dataset.nodeId;
    const node = state.nodes[id];
    if (!node) return;

    /* toggle arrow */
    if (e.target.closest('[data-toggle]')) {
      setExpanded(id, !state.expandedIds.has(id));
      return;
    }

    /* checkbox */
    if (e.target.matches('.tree-checkbox')) {
      setChecked(id, e.target.checked);
      return;
    }

    /* leaf click → show detail */
    if (node.isLeaf) {
      showDetail(id);
    } else {
      /* internal node click → toggle expand */
      setExpanded(id, !state.expandedIds.has(id));
    }
  });

  /* right-click context menu */
  el('tree-root').addEventListener('contextmenu', e => {
    const row = e.target.closest('[data-node-id]');
    if (!row) return;
    e.preventDefault();
    showCtxMenu(e.clientX, e.clientY, row.dataset.nodeId);
  });

  el('ctx-menu').addEventListener('click', e => {
    const action = e.target.dataset.action;
    if (!action || !ctxTargetId) return;
    const id = ctxTargetId;
    hideCtxMenu();
    if (action === 'run' || action === 'run-subtree') runNode(id);
    if (action === 'skip')  skipNode(id);
    if (action === 'reset') resetNode(id);
  });

  document.addEventListener('click', e => {
    if (!el('ctx-menu').hidden && !e.target.closest('.ctx-menu')) hideCtxMenu();
  });

  /* ── Toolbar buttons ─────────────────────────────────────────────── */
  el('btn-run-all').addEventListener('click', () => {
    runLeaves(state.leaves.filter(l => l.status !== 'skipped'));
  });

  el('btn-run-selected').addEventListener('click', () => {
    const sel = [...state.checkedIds].map(id => state.nodes[id]).filter(Boolean);
    const leavesToRun = sel.flatMap(n => getLeaves(n)).filter(l => l.status !== 'skipped');
    const unique = [...new Map(leavesToRun.map(l => [l.id, l])).values()];
    runLeaves(unique);
  });

  el('btn-stop').addEventListener('click', () => {
    state.stopRequested = true;
    el('btn-stop').disabled = true;
  });

  el('btn-reset').addEventListener('click', () => {
    if (state.isRunning) return;
    state.leaves.forEach(l => {
      l.status = 'idle'; l.startedAt = null; l.finishedAt = null; l.logs = '';
      renderNode(l.id);
    });
    Object.values(state.nodes).filter(n => !n.isLeaf).forEach(n => renderNode(n.id));
    updateDetail(state.selectedId);
    updateSummary();
  });

  el('btn-expand-all').addEventListener('click', expandAll);
  el('btn-collapse-all').addEventListener('click', collapseAll);

  el('sel-concurrency').addEventListener('change', e => {
    state.concurrency = parseInt(e.target.value, 10);
  });

  /* ── Detail panel buttons ────────────────────────────────────────── */
  el('btn-detail-run').addEventListener('click', () => {
    if (state.selectedId) runNode(state.selectedId);
  });

  el('btn-detail-skip').addEventListener('click', () => {
    if (state.selectedId) { skipNode(state.selectedId); updateDetail(state.selectedId); }
  });

  el('btn-detail-reset').addEventListener('click', () => {
    if (state.selectedId) { resetNode(state.selectedId); updateDetail(state.selectedId); }
  });

  el('btn-clear-log').addEventListener('click', () => {
    if (state.selectedId) {
      const node = state.nodes[state.selectedId];
      if (node) { node.logs = ''; el('detail-log').textContent = '(no output)'; }
    }
  });
}

/* ── Boot ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
