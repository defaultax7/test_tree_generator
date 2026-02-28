/* ═══════════════════════════════════════════════════════════════════
   Test Combination Tree  — app.js
   ═══════════════════════════════════════════════════════════════════ */

/* ── 1. Dimension config ──────────────────────────────────────────── */
/* Stored in state.dimensions — edit via the toolbar "Edit Dims" modal */

/* ── 2. State ─────────────────────────────────────────────────────── */
const state = {
  dimensions: [
    { name: 'Testing Env',  key: 'env',      values: ['local', 'remote'] },
    { name: 'Platform',     key: 'platform', values: ['native', 'docker', 'k8s'] },
    { name: 'Action',       key: 'action',   values: ['get', 'post'] },
  ],
  resultDimensions: [
    { name: 'Backend',  key: 'backend'  },
    { name: 'Frontend', key: 'frontend' },
  ],
  tree:           null,
  nodes:          {},
  leaves:         [],
  selectedId:     null,
  expandedIds:    new Set(),
  activeFilters:  {},
  viewMode:       'diagram', // 'list' | 'diagram'
};

/* ── 3. Tree builder ──────────────────────────────────────────────── */
function buildTree() {
  const nodes = {};
  const leaves = [];

  function recurse(depth, path) {
    if (depth === state.dimensions.length) {
      const id = path.join('.');
      const node = {
        id, path: [...path], depth,
        label:    path[path.length - 1],
        children: [],
        isLeaf:   true,
        results:  Object.fromEntries(state.resultDimensions.map(r => [r.key, 'untested'])),
        remark:   '',
      };
      nodes[id] = node;
      leaves.push(node);
      return node;
    }
    const dim = state.dimensions[depth];
    const id  = path.length ? path.join('.') : '__root__';
    const node = {
      id, path: [...path], depth,
      label:    path.length ? path[path.length - 1] : 'root',
      children: dim.values.map(v => recurse(depth + 1, [...path, v])),
      isLeaf:   false,
      status:   'untested',
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

/* Derive a single display status from a leaf's multi-dimensional results */
function derivedLeafStatus(leaf) {
  const vals = Object.values(leaf.results);
  if (!vals.length)                          return 'untested';
  if (vals.every(v => v === 'untested'))     return 'untested';
  if (vals.every(v => v === 'pass'))         return 'pass';
  if (vals.every(v => v === 'skipped'))      return 'skipped';
  if (vals.every(v => v === 'fail'))         return 'fail';
  if (vals.some(v => v === 'running'))       return 'running';
  if (vals.some(v => v === 'fail'))          return 'fail';
  return 'partial';
}

/* Aggregate status for a node (used for box class / badge on internal nodes) */
function aggregateStatus(node) {
  if (node.isLeaf) return derivedLeafStatus(node);
  const statuses = getLeaves(node).map(derivedLeafStatus);
  if (statuses.every(s => s === 'untested')) return 'untested';
  if (statuses.every(s => s === 'pass'))     return 'pass';
  if (statuses.every(s => s === 'skipped'))  return 'skipped';
  if (statuses.every(s => s === 'fail'))     return 'fail';
  if (statuses.some(s => s === 'running'))   return 'running';
  if (statuses.some(s => s === 'fail'))      return 'fail';
  return 'partial';
}

/* Aggregate a single result-dimension key across all leaf descendants */
function aggregateOneResult(node, key) {
  const vals = getLeaves(node).map(l => (l.results && l.results[key]) || 'untested');
  if (vals.every(v => v === 'untested')) return 'untested';
  if (vals.every(v => v === 'pass'))     return 'pass';
  if (vals.every(v => v === 'skipped'))  return 'skipped';
  if (vals.every(v => v === 'fail'))     return 'fail';
  if (vals.some(v => v === 'running'))   return 'running';
  if (vals.some(v => v === 'fail'))      return 'fail';
  return 'partial';
}

function summaryCounts() {
  const total = state.leaves.length;
  return state.resultDimensions.map(r => {
    const c = { key: r.key, name: r.name, total, pass: 0, fail: 0, skipped: 0, untested: 0 };
    state.leaves.forEach(l => {
      const s = (l.results && l.results[r.key]) || 'untested';
      c[s] = (c[s] || 0) + 1;
    });
    return c;
  });
}

/* ── 5. DOM helpers ───────────────────────────────────────────────── */
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
  return state.dimensions.every((dim, i) => {
    const val = node.path[i];
    return state.activeFilters[dim.key].has(val);
  });
}

function applyFilters() {
  /* ── List view ── */
  state.leaves.forEach(leaf => {
    const rowEl = document.querySelector(`[data-node-id="${leaf.id}"]`);
    if (!rowEl) return;
    const nodeEl = rowEl.closest('.tree-node');
    if (!nodeEl) return;
    nodeEl.classList.toggle('filtered', !isNodeVisible(leaf));
  });
  /* hide internal list nodes that have no visible children */
  $$('.tree-node[data-depth]').forEach(nodeEl => {
    const depth = parseInt(nodeEl.dataset.depth, 10);
    if (depth === state.dimensions.length) return;   // leaf
    const hasVisible = !!nodeEl.querySelector('.tree-node:not(.filtered)');
    nodeEl.classList.toggle('filtered', !hasVisible);
  });

  /* ── Diagram view ── */
  state.leaves.forEach(leaf => {
    const li = document.querySelector(`#tree-diagram li[data-node-id="${leaf.id}"]`);
    if (li) li.classList.toggle('filtered', !isNodeVisible(leaf));
  });
  /* hide internal diagram nodes whose every leaf descendant is filtered */
  $$('#tree-diagram li[data-node-id]').forEach(li => {
    const node = state.nodes[li.dataset.nodeId];
    if (!node || node.isLeaf) return;
    const anyVisible = getLeaves(node).some(l => isNodeVisible(l));
    li.classList.toggle('filtered', !anyVisible);
  });
}

/* ── 8. Render a single tree row ──────────────────────────────────── */
function renderNode(id) {
  const node  = state.nodes[id];
  if (!node) return;
  const rowEl = document.querySelector(`[data-node-id="${id}"]`);
  if (!rowEl) return;

  /* update each result-dim dot */
  state.resultDimensions.forEach(r => {
    const dot = rowEl.querySelector(`[data-result-key="${r.key}"]`);
    if (!dot) return;
    const s = node.isLeaf
      ? ((node.results && node.results[r.key]) || 'untested')
      : aggregateOneResult(node, r.key);
    dot.className = `status-dot ${s}`;
  });

  /* update badge on internal nodes (uses derived aggregate for counts) */
  const badgeEl = rowEl.querySelector('.node-badge');
  if (badgeEl && !node.isLeaf) {
    const leaves = getLeaves(node);
    const pass   = leaves.filter(l => derivedLeafStatus(l) === 'pass').length;
    const fail   = leaves.filter(l => derivedLeafStatus(l) === 'fail').length;
    const total  = leaves.length;
    const status = aggregateStatus(node);
    badgeEl.textContent = fail ? `${fail}✗ ${pass}✓` : `${pass}/${total}`;
    badgeEl.className   = `node-badge ${status}`;
  }

  /* keep diagram in sync */
  renderDiagramNode(id);
}

function renderDiagramNode(id) {
  const node = state.nodes[id];
  if (!node) return;
  const box = document.getElementById(`tdd-${id}`);
  if (!box) return;

  const status = aggregateStatus(node);

  /* update box class */
  const base = `td-box ${node.isLeaf ? 'td-leaf' : 'td-internal'} ${status}`;
  box.className = state.selectedId === id ? `${base} selected` : base;

  /* update each result-dim dot */
  state.resultDimensions.forEach(r => {
    const dot = box.querySelector(`[data-result-key="${r.key}"]`);
    if (!dot) return;
    const s = node.isLeaf
      ? ((node.results && node.results[r.key]) || 'untested')
      : aggregateOneResult(node, r.key);
    dot.className = `status-dot ${s}`;
  });

  /* update badge */
  const badge = box.querySelector('.node-badge');
  if (badge && !node.isLeaf) {
    const leaves = getLeaves(node);
    const pass   = leaves.filter(l => derivedLeafStatus(l) === 'pass').length;
    const fail   = leaves.filter(l => derivedLeafStatus(l) === 'fail').length;
    const total  = leaves.length;
    badge.textContent = fail ? `${fail}✗ ${pass}✓` : `${pass}/${total}`;
    badge.className   = `node-badge ${status}`;
  }

  /* remark dot for leaves */
  if (node.isLeaf) {
    const rdot = box.querySelector('.td-remark-dot');
    if (rdot) rdot.hidden = !node.remark;
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

  /* multi-dot group — one dot per result dimension */
  const dotsHTML = state.resultDimensions
    .map(r => `<span class="status-dot untested" data-result-key="${r.key}" title="${r.name}"></span>`)
    .join('');

  wrapper.innerHTML = `
    <div class="tree-row" data-node-id="${node.id}" data-leaf="${node.isLeaf}">
      <span class="tree-indent">${indentHTML}</span>
      <span class="tree-toggle ${node.isLeaf ? 'leaf' : ''}" data-toggle="${node.id}">${arrow}</span>
      <span class="status-dots">${dotsHTML}</span>
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
  state.tree.children.forEach(child => container.appendChild(buildNodeEl(child)));
}

/* ── 10. Build diagram DOM ────────────────────────────────────────── */
function buildDiagramNode(node) {
  const li = document.createElement('li');
  li.dataset.nodeId = node.id;
  const status = aggregateStatus(node);

  /* box */
  const box = document.createElement('div');
  box.id             = `tdd-${node.id}`;
  box.className      = `td-box ${node.isLeaf ? 'td-leaf' : 'td-internal'} ${status}`;
  box.dataset.nodeId = node.id;

  /* multi-dot group — one dot per result dimension */
  const dotGroup = document.createElement('span');
  dotGroup.className = 'status-dots';
  state.resultDimensions.forEach(r => {
    const dot = document.createElement('span');
    const s = node.isLeaf
      ? ((node.results && node.results[r.key]) || 'untested')
      : aggregateOneResult(node, r.key);
    dot.className        = `status-dot ${s}`;
    dot.dataset.resultKey = r.key;
    dot.title            = r.name;
    dotGroup.appendChild(dot);
  });
  box.appendChild(dotGroup);

  const label = document.createElement('span');
  label.className   = 'td-label';
  label.textContent = node.label;
  box.appendChild(label);

  if (!node.isLeaf) {
    const leaves = getLeaves(node);
    const pass   = leaves.filter(l => derivedLeafStatus(l) === 'pass').length;
    const fail   = leaves.filter(l => derivedLeafStatus(l) === 'fail').length;
    const total  = leaves.length;
    const badge  = document.createElement('span');
    badge.className   = `node-badge ${status}`;
    badge.textContent = fail ? `${fail}✗ ${pass}✓` : `${pass}/${total}`;
    box.appendChild(badge);
  } else {
    /* remark indicator dot */
    const rdot = document.createElement('span');
    rdot.className = 'td-remark-dot';
    rdot.title     = 'Has remark';
    rdot.hidden    = !node.remark;
    box.appendChild(rdot);
  }

  li.appendChild(box);

  if (!node.isLeaf && node.children.length) {
    const ul = document.createElement('ul');
    node.children.forEach(child => ul.appendChild(buildDiagramNode(child)));
    li.appendChild(ul);
  }

  return li;
}

function buildDiagram() {
  const container = el('tree-diagram');
  container.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'td-tree';
  state.tree.children.forEach(child => ul.appendChild(buildDiagramNode(child)));
  container.appendChild(ul);
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
    .map((seg, i) => `<span class="breadcrumb-seg">${seg}</span>${i < node.path.length - 1 ? '<span class="breadcrumb-sep">›</span>' : ''}`)
    .join('');

  /* status badge — show derived overall status */
  const derived = derivedLeafStatus(node);
  const badge   = el('detail-status-badge');
  badge.textContent = derived.toUpperCase();
  badge.className   = `status-badge ${derived}`;

  /* meta cards */
  el('detail-meta').innerHTML = state.dimensions
    .map((dim, i) => `<div class="meta-card">
      <div class="meta-card-label">${dim.name}</div>
      <div class="meta-card-value">${node.path[i]}</div>
    </div>`)
    .join('');

  /* per-result-dim action rows (injected dynamically) */
  el('detail-actions').innerHTML = state.resultDimensions.map(r => {
    const s = (node.results && node.results[r.key]) || 'untested';
    return `<div class="detail-result-row">
      <span class="result-row-label">${r.name}</span>
      <div class="result-row-btns">
        <button class="btn btn-mark-pass btn-sm" data-result-key="${r.key}" data-action="pass"
          ${s === 'pass'     ? 'disabled' : ''}>✓ Pass</button>
        <button class="btn btn-mark-fail btn-sm" data-result-key="${r.key}" data-action="fail"
          ${s === 'fail'     ? 'disabled' : ''}>✗ Fail</button>
        <button class="btn btn-mark-skip btn-sm" data-result-key="${r.key}" data-action="skip"
          ${s === 'skipped'  ? 'disabled' : ''}>⊘ Skip</button>
        <button class="btn btn-ghost     btn-sm" data-result-key="${r.key}" data-action="reset"
          ${s === 'untested' ? 'disabled' : ''}>↺ Reset</button>
      </div>
    </div>`;
  }).join('');

  /* remark */
  el('remark-input').value = node.remark;
}

function showDetail(id) {
  const prev = state.selectedId;
  state.selectedId = id;

  /* deselect previous in list view */
  $$('.tree-row.selected').forEach(r => r.classList.remove('selected'));
  const row = document.querySelector(`[data-node-id="${id}"]`);
  if (row) row.classList.add('selected');

  /* deselect previous in diagram view */
  if (prev) renderDiagramNode(prev);
  renderDiagramNode(id);

  updateDetail(id);
}

/* ── 11. Summary bar ──────────────────────────────────────────────── */
function updateSummary() {
  const dimCounts = summaryCounts(); /* array of { key, name, total, pass, fail, skipped, untested } */

  const pct2 = (v, total) => `${total ? ((v / total) * 100).toFixed(1) : 0}%`;

  el('summary-counts').innerHTML = dimCounts.map(c => {
    const done = c.pass + c.fail + c.skipped;
    const pct  = c.total ? Math.round((done / c.total) * 100) : 0;
    return `<span class="summary-result-row">
      <span class="summary-result-label">${c.name}</span>
      <span class="summary-count">
        <span class="summary-count-dot" style="background:var(--c-pass)"></span>
        <span class="summary-count-val">${c.pass}</span>
      </span>
      <span class="summary-count">
        <span class="summary-count-dot" style="background:var(--c-fail)"></span>
        <span class="summary-count-val">${c.fail}</span>
      </span>
      <span class="summary-count">
        <span class="summary-count-dot" style="background:var(--c-skipped)"></span>
        <span class="summary-count-val">${c.skipped}</span>
      </span>
      <span class="summary-count">
        <span class="summary-count-dot" style="background:var(--c-untested)"></span>
        <span class="summary-count-val">${c.untested}</span>
      </span>
      <div class="summary-mini-bar">
        <div class="progress-fill pass"    style="width:${pct2(c.pass,    c.total)}"></div>
        <div class="progress-fill fail"    style="width:${pct2(c.fail,    c.total)}"></div>
        <div class="progress-fill skipped" style="width:${pct2(c.skipped, c.total)}"></div>
      </div>
      <span class="summary-pct-mini">${pct}%</span>
    </span>`;
  }).join('');

  /* update the main progress bar using the average across all result dims */
  const totalSlots = dimCounts.reduce((s, c) => s + c.total, 0);
  const totalDone  = dimCounts.reduce((s, c) => s + c.pass + c.fail + c.skipped, 0);
  const totalPass  = dimCounts.reduce((s, c) => s + c.pass, 0);
  const totalFail  = dimCounts.reduce((s, c) => s + c.fail, 0);
  const totalSkip  = dimCounts.reduce((s, c) => s + c.skipped, 0);
  const avgPct     = totalSlots ? Math.round((totalDone / totalSlots) * 100) : 0;

  const pctOfAll = v => `${totalSlots ? ((v / totalSlots) * 100).toFixed(1) : 0}%`;
  el('prog-pass').style.width    = pctOfAll(totalPass);
  el('prog-fail').style.width    = pctOfAll(totalFail);
  el('prog-skipped').style.width = pctOfAll(totalSkip);
  el('summary-pct').textContent  = `${avgPct}%`;
}

/* ── 12. Filter bar ───────────────────────────────────────────────── */
function buildFilterBar() {
  el('filter-bar').innerHTML = state.dimensions.map(dim => `
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

/* ── 14. Node actions ─────────────────────────────────────────────── */
function markNode(id, status) {
  const node = state.nodes[id];
  if (!node) return;
  getLeaves(node).forEach(l => {
    /* set every result dimension to the same status */
    state.resultDimensions.forEach(r => { l.results[r.key] = status; });
    renderNode(l.id);
    renderAncestors(l);
  });
  updateDetail(id);
  updateSummary();
}

/* Set a single result dimension on a single leaf */
function markNodeOneResult(id, resultKey, status) {
  const node = state.nodes[id];
  if (!node || !node.isLeaf) return;
  node.results[resultKey] = status;
  renderNode(id);
  renderAncestors(node);
  updateDetail(id);
  updateSummary();
}

function skipNode(id)  { markNode(id, 'skipped'); }
function resetNode(id) { markNode(id, 'untested'); }

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

/* ── 16. View mode ────────────────────────────────────────────────── */
function setViewMode(mode) {
  state.viewMode = mode;
  const isDiagram = mode === 'diagram';

  el('tree-root').hidden    =  isDiagram;
  el('tree-diagram').hidden = !isDiagram;
  el('workspace').classList.toggle('diagram-mode', isDiagram);

  el('btn-view-list').classList.toggle('view-active',    !isDiagram);
  el('btn-view-diagram').classList.toggle('view-active',  isDiagram);

  /* expand/collapse only relevant in list view */
  el('btn-expand-all').disabled   = isDiagram;
  el('btn-collapse-all').disabled = isDiagram;
}

/* ── 17. Rebuild (after dimension changes) ─────────────────────────── */
function rebuildAll() {
  const { root, nodes, leaves } = buildTree();
  state.tree       = root;
  state.nodes      = nodes;
  state.leaves     = leaves;
  state.selectedId = null;

  /* reset filters — all values active */
  state.activeFilters = {};
  state.dimensions.forEach(dim => {
    state.activeFilters[dim.key] = new Set(dim.values);
  });

  /* reset expanded — expand all */
  state.expandedIds = new Set();
  Object.values(nodes).filter(n => !n.isLeaf).forEach(n => state.expandedIds.add(n.id));

  /* re-render */
  buildFilterBar();
  renderFullTree();
  buildDiagram();
  updateSummary();

  /* reset detail panel */
  el('detail-empty').hidden   = false;
  el('detail-content').hidden = true;
}

/* ── 18. Dimension editor modal ────────────────────────────────────── */
function openDimModal() {
  /* work on a deep clone so Cancel discards changes */
  let draft = state.dimensions.map(d => ({ name: d.name, key: d.key, values: [...d.values] }));

  const backdrop = document.createElement('div');
  backdrop.className = 'dim-backdrop';
  backdrop.innerHTML = `
    <div class="dim-modal" role="dialog" aria-modal="true" aria-label="Edit Dimensions">
      <div class="dim-modal-header">
        <span class="dim-modal-title">Edit Dimensions</span>
        <button class="btn btn-ghost btn-xs dim-modal-close" title="Close">✕</button>
      </div>
      <div class="dim-modal-body" id="dim-modal-body"></div>
      <div class="dim-modal-footer">
        <button class="btn btn-ghost btn-sm" id="dim-btn-add-dim">+ Add Dimension</button>
        <div style="flex:1"></div>
        <button class="btn btn-secondary btn-sm" id="dim-btn-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="dim-btn-apply">Apply</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  function renderBody() {
    const body = backdrop.querySelector('#dim-modal-body');
    body.innerHTML = '';
    draft.forEach((dim, dimIdx) => {
      const card = document.createElement('div');
      card.className = 'dim-card';
      card.innerHTML = `
        <div class="dim-card-header">
          <input class="dim-name-input" value="${dim.name}" placeholder="Dimension name" data-dim="${dimIdx}" />
          <button class="btn btn-ghost btn-xs dim-remove-dim" data-dim="${dimIdx}" title="Remove dimension"
            ${draft.length <= 1 ? 'disabled' : ''}>✕</button>
        </div>
        <div class="dim-values">
          ${dim.values.map((v, vi) => `
            <span class="dim-val-chip">${v}
              <button class="dim-val-remove" data-dim="${dimIdx}" data-val="${vi}"
                title="Remove value" ${dim.values.length <= 1 ? 'disabled' : ''}>✕</button>
            </span>`).join('')}
          <input class="dim-val-input" placeholder="Add value…" data-dim="${dimIdx}" />
        </div>`;
      body.appendChild(card);
    });
  }

  renderBody();

  /* ── event delegation inside modal ── */
  backdrop.addEventListener('input', e => {
    if (e.target.classList.contains('dim-name-input')) {
      draft[+e.target.dataset.dim].name = e.target.value;
    }
  });

  backdrop.addEventListener('keydown', e => {
    if (e.target.classList.contains('dim-val-input') && e.key === 'Enter') {
      const i   = +e.target.dataset.dim;
      const val = e.target.value.trim();
      if (!val) return;
      if (draft[i].values.includes(val)) { e.target.select(); return; }
      draft[i].values.push(val);
      e.target.value = '';
      renderBody();
      backdrop.querySelector(`[data-dim="${i}"].dim-val-input`).focus();
    }
  });

  backdrop.addEventListener('click', e => {
    if (e.target.classList.contains('dim-val-remove')) {
      const i = +e.target.dataset.dim, vi = +e.target.dataset.val;
      if (draft[i].values.length <= 1) return;
      draft[i].values.splice(vi, 1);
      renderBody(); return;
    }
    if (e.target.classList.contains('dim-remove-dim')) {
      const i = +e.target.dataset.dim;
      if (draft.length <= 1) return;
      draft.splice(i, 1);
      renderBody(); return;
    }
    if (e.target.id === 'dim-btn-add-dim') {
      draft.push({ name: 'New Dimension', key: '', values: ['value1'] });
      renderBody();
      const inputs = backdrop.querySelectorAll('.dim-name-input');
      const last = inputs[inputs.length - 1];
      last.focus(); last.select(); return;
    }
    if (e.target.id === 'dim-btn-cancel' || e.target.classList.contains('dim-modal-close')) {
      backdrop.remove(); return;
    }
    if (e.target.id === 'dim-btn-apply') {
      for (const d of draft) {
        if (!d.name.trim()) { alert('Each dimension must have a name.'); return; }
        if (!d.values.length) { alert(`Dimension "${d.name}" must have at least one value.`); return; }
      }
      /* derive keys from names, ensuring uniqueness */
      const seen = {};
      state.dimensions = draft.map(d => {
        let key = d.name.trim().toLowerCase().replace(/\s+/g, '_');
        if (seen[key] !== undefined) key += '_' + (++seen[key]);
        else seen[key] = 0;
        return { name: d.name.trim(), key, values: d.values };
      });
      backdrop.remove();
      rebuildAll(); return;
    }
    if (e.target === backdrop) { backdrop.remove(); }
  });
}

/* ── 19. Result-dimension editor modal ─────────────────────────────── */
/* rebuildResultData — reshapes leaf.results without regenerating the tree */
function rebuildResultData() {
  state.leaves.forEach(leaf => {
    const fresh = Object.fromEntries(state.resultDimensions.map(r => [r.key, 'untested']));
    /* preserve status for keys that still exist */
    if (leaf.results) {
      state.resultDimensions.forEach(r => {
        if (leaf.results[r.key] !== undefined) fresh[r.key] = leaf.results[r.key];
      });
    }
    leaf.results = fresh;
  });
  /* rebuild both views — dot structure (count + data-result-key) has changed */
  renderFullTree();
  buildDiagram();
  applyFilters();
  /* update detail panel if open */
  if (state.selectedId) updateDetail(state.selectedId);
  updateSummary();
}

function openResultDimModal() {
  /* work on a deep clone so Cancel discards changes */
  let draft = state.resultDimensions.map(r => ({ name: r.name, key: r.key }));

  const backdrop = document.createElement('div');
  backdrop.className = 'dim-backdrop';
  backdrop.innerHTML = `
    <div class="dim-modal" role="dialog" aria-modal="true" aria-label="Edit Result Dimensions">
      <div class="dim-modal-header">
        <span class="dim-modal-title">Edit Result Dimensions</span>
        <button class="btn btn-ghost btn-xs dim-modal-close" title="Close">✕</button>
      </div>
      <div class="dim-modal-body" id="rdim-modal-body"></div>
      <div class="dim-modal-footer">
        <button class="btn btn-ghost btn-sm" id="rdim-btn-add">+ Add Result Dimension</button>
        <div style="flex:1"></div>
        <button class="btn btn-secondary btn-sm" id="rdim-btn-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="rdim-btn-apply">Apply</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  function renderBody() {
    const body = backdrop.querySelector('#rdim-modal-body');
    body.innerHTML = '';
    draft.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'dim-card';
      card.innerHTML = `
        <div class="dim-card-header">
          <input class="dim-name-input" value="${r.name}" placeholder="Result dimension name"
            data-ridx="${i}" />
          <button class="btn btn-ghost btn-xs rdim-remove" data-ridx="${i}" title="Remove"
            ${draft.length <= 1 ? 'disabled' : ''}>✕</button>
        </div>`;
      body.appendChild(card);
    });
  }

  renderBody();

  backdrop.addEventListener('input', e => {
    if (e.target.classList.contains('dim-name-input')) {
      draft[+e.target.dataset.ridx].name = e.target.value;
    }
  });

  backdrop.addEventListener('click', e => {
    if (e.target.classList.contains('rdim-remove')) {
      const i = +e.target.dataset.ridx;
      if (draft.length <= 1) return;
      draft.splice(i, 1); renderBody(); return;
    }
    if (e.target.id === 'rdim-btn-add') {
      draft.push({ name: 'New Result', key: '' });
      renderBody();
      const inputs = backdrop.querySelectorAll('.dim-name-input');
      const last = inputs[inputs.length - 1];
      last.focus(); last.select(); return;
    }
    if (e.target.id === 'rdim-btn-cancel' || e.target.classList.contains('dim-modal-close')) {
      backdrop.remove(); return;
    }
    if (e.target.id === 'rdim-btn-apply') {
      for (const r of draft) {
        if (!r.name.trim()) { alert('Each result dimension must have a name.'); return; }
      }
      /* derive unique keys from names */
      const seen = {};
      state.resultDimensions = draft.map(r => {
        let key = r.name.trim().toLowerCase().replace(/\s+/g, '_');
        if (seen[key] !== undefined) key += '_' + (++seen[key]);
        else seen[key] = 0;
        return { name: r.name.trim(), key };
      });
      backdrop.remove();
      rebuildResultData(); return;
    }
    if (e.target === backdrop) { backdrop.remove(); }
  });
}

/* ── 20. Excel export ──────────────────────────────────────────────── */
function exportExcel() {
  const XLSX = window.XLSX;
  if (!XLSX) { alert('xlsx-js-style not loaded.'); return; }

  /* ── Status cell styles ───────────────────────────────────────── */
  const statusStyle = {
    pass:     { fill: { patternType: 'solid', fgColor: { rgb: 'C6EFCE' } }, font: { color: { rgb: '006100' }, bold: true } },
    fail:     { fill: { patternType: 'solid', fgColor: { rgb: 'FFC7CE' } }, font: { color: { rgb: '9C0006' }, bold: true } },
    untested: { fill: { patternType: 'solid', fgColor: { rgb: 'FFEB9C' } }, font: { color: { rgb: '9C5700' } } },
    skipped:  { fill: { patternType: 'solid', fgColor: { rgb: 'FFD966' } }, font: { color: { rgb: '7F6000' } } },
  };

  /* Convert 0-based column index to Excel letter (A, B, …, Z, AA, …) */
  function colLetter(c) {
    let s = ''; c++;
    while (c > 0) { s = String.fromCharCode(((c - 1) % 26) + 65) + s; c = Math.floor((c - 1) / 26); }
    return s;
  }

  /* ── Sheet 1: List ─────────────────────────────────────────────── */
  /* Headers: one per tree dimension + one per result dimension + Remark */
  const resultHeaders = state.resultDimensions.map(r => `${r.name} Status`);
  const listHeaders   = [...state.dimensions.map(d => d.name), ...resultHeaders, 'Remark'];
  const listRows = [listHeaders];
  state.leaves.forEach(leaf => {
    const resultValues = state.resultDimensions.map(r => (leaf.results && leaf.results[r.key]) || 'untested');
    listRows.push([...leaf.path, ...resultValues, leaf.remark]);
  });
  const ws1 = XLSX.utils.aoa_to_sheet(listRows);
  ws1['!cols'] = [
    ...state.dimensions.map(() => ({ wch: 14 })),
    ...state.resultDimensions.map(() => ({ wch: 14 })),
    { wch: 36 },
  ];

  /* Colour each result-dimension status column */
  state.resultDimensions.forEach((r, ri) => {
    const colIdx = state.dimensions.length + ri;
    const col    = colLetter(colIdx);
    state.leaves.forEach((leaf, rowIdx) => {
      const addr   = `${col}${rowIdx + 2}`; /* row 1 = header */
      const cell   = ws1[addr];
      const status = (leaf.results && leaf.results[r.key]) || 'untested';
      if (cell && statusStyle[status]) cell.s = statusStyle[status];
    });
  });

  /* ── Sheet 2: Top-down tree diagram ───────────────────────────── */
  let leafIdx = 0;
  function assignCols(node) {
    if (node.isLeaf) {
      node._c = leafIdx++; node._cEnd = node._c;
    } else {
      node.children.forEach(assignCols);
      node._c    = node.children[0]._c;
      node._cEnd = node.children[node.children.length - 1]._cEnd;
    }
  }
  assignCols(state.tree);

  const numCols   = leafIdx;
  const numLevels = state.dimensions.length;
  const numRows   = numLevels + 1; /* +1 for remarks */

  const grid      = Array.from({ length: numRows }, () => Array(numCols).fill(null));
  const merges    = [];
  const leafCells = [];

  function fillGrid(node) {
    if (node.id === '__root__') { node.children.forEach(fillGrid); return; }
    const row = node.depth - 1;
    if (node.isLeaf) {
      /* multi-line cell: label + one line per result dimension */
      const resultLines = state.resultDimensions
        .map(r => `${r.name}: ${(node.results && node.results[r.key]) || 'untested'}`)
        .join('\n');
      grid[row][node._c] = `${node.label}\n${resultLines}`;
      leafCells.push({ row, col: node._c, status: derivedLeafStatus(node) });
      if (node.remark) grid[numLevels][node._c] = node.remark;
    } else {
      const status = aggregateStatus(node);
      grid[row][node._c] = `${node.label} (${status})`;
      if (node._cEnd > node._c) {
        merges.push({ s: { r: row, c: node._c }, e: { r: row, c: node._cEnd } });
      }
      node.children.forEach(fillGrid);
    }
  }
  fillGrid(state.tree);

  const ws2 = XLSX.utils.aoa_to_sheet(grid);
  ws2['!merges'] = merges;
  ws2['!cols']   = Array.from({ length: numCols }, () => ({ wch: 18 }));
  ws2['!rows']   = Array.from({ length: numRows }, () => ({ hpt: 16 + state.resultDimensions.length * 14 }));

  /* Enable text wrap for leaf cells (they contain \n) */
  leafCells.forEach(({ row, col, status }) => {
    const addr = `${colLetter(col)}${row + 1}`;
    const cell = ws2[addr];
    if (!cell) return;
    cell.s = {
      ...(statusStyle[status] || {}),
      alignment: { wrapText: true, vertical: 'top' },
    };
  });

  /* ── Build workbook ───────────────────────────────────────────── */
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'List');
  XLSX.utils.book_append_sheet(wb, ws2, 'Tree');
  XLSX.writeFile(wb, 'test-combinations.xlsx');
}

/* ── 21. Init ─────────────────────────────────────────────────────── */
function init() {
  /* build data */
  const { root, nodes, leaves } = buildTree();
  state.tree   = root;
  state.nodes  = nodes;
  state.leaves = leaves;

  /* init filters — all values active */
  state.dimensions.forEach(dim => {
    state.activeFilters[dim.key] = new Set(dim.values);
  });

  /* init expanded state — expand all */
  Object.values(nodes).filter(n => !n.isLeaf).forEach(n => state.expandedIds.add(n.id));

  /* render */
  buildFilterBar();
  renderFullTree();
  buildDiagram();
  updateSummary();
  setViewMode('diagram');

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
    if (action === 'pass')  markNode(id, 'pass');
    if (action === 'fail')  markNode(id, 'fail');
    if (action === 'skip')  markNode(id, 'skipped');
    if (action === 'reset') markNode(id, 'untested');
  });

  document.addEventListener('click', e => {
    if (!el('ctx-menu').hidden && !e.target.closest('.ctx-menu')) hideCtxMenu();
  });

  /* ── Toolbar buttons ─────────────────────────────────────────────── */
  el('btn-expand-all').addEventListener('click', expandAll);
  el('btn-collapse-all').addEventListener('click', collapseAll);
  el('btn-view-list').addEventListener('click',    () => setViewMode('list'));
  el('btn-view-diagram').addEventListener('click', () => setViewMode('diagram'));
  el('btn-edit-dims').addEventListener('click', openDimModal);
  el('btn-edit-result-dims').addEventListener('click', openResultDimModal);
  el('btn-export').addEventListener('click', exportExcel);

  /* ── Diagram interactions ────────────────────────────────────────── */
  el('tree-diagram').addEventListener('click', e => {
    const box = e.target.closest('.td-box');
    if (!box) return;
    const id   = box.dataset.nodeId;
    const node = state.nodes[id];
    if (node && node.isLeaf) showDetail(id);
  });

  el('tree-diagram').addEventListener('contextmenu', e => {
    const box = e.target.closest('.td-box');
    if (!box) return;
    e.preventDefault();
    showCtxMenu(e.clientX, e.clientY, box.dataset.nodeId);
  });

  /* ── Detail panel: per-result-dim mark buttons (event delegation) ── */
  el('detail-content').addEventListener('click', e => {
    const btn = e.target.closest('button[data-result-key][data-action]');
    if (!btn || !state.selectedId) return;
    const resultKey = btn.dataset.resultKey;
    const action    = btn.dataset.action;
    const statusMap = { pass: 'pass', fail: 'fail', skip: 'skipped', reset: 'untested' };
    const newStatus = statusMap[action];
    if (newStatus !== undefined) markNodeOneResult(state.selectedId, resultKey, newStatus);
  });

  /* ── Remark textarea ─────────────────────────────────────────────── */
  el('remark-input').addEventListener('input', e => {
    if (!state.selectedId) return;
    const node = state.nodes[state.selectedId];
    if (node) {
      node.remark = e.target.value;
      renderDiagramNode(state.selectedId);
    }
  });
}

/* ── Boot ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
