// ═══════════════════════════════════════════════════════════
//  COULEURS PAR RÈGLE
// ═══════════════════════════════════════════════════════════
const RULE_COLORS = [
  '#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6',
  '#8b5cf6','#f97316','#14b8a6','#ec4899','#84cc16',
];
function ruleColor(ruleName) {
  const idx = (lastConfig?.rules || []).findIndex(r => r.name === ruleName);
  return idx >= 0 ? RULE_COLORS[idx % RULE_COLORS.length] : '#94a3b8';
}

function ruleType(ruleName) {
  const rule = (lastConfig?.rules || []).find(r => r.name === ruleName);
  return rule?.rule_type || 'incoherence';
}

// ═══════════════════════════════════════════════════════════
//  PAGINATION SERVEUR — fetch + render
// ═══════════════════════════════════════════════════════════
async function fetchPage(page) {
  if (!currentToken) { rebuildTable(); return; }
  _pageNum = page;

  const p = new URLSearchParams({ page, size: _pageSize });

  // Types actifs : union additive des chips (BOTH → KO+OK+DIVERGENT+PRESENT, orphelins → leur type)
  const types = [];
  if (activeFilters.has('BOTH'))       { types.push('KO', 'OK', 'DIVERGENT', 'PRESENT'); }
  if (activeFilters.has('ORPHELIN_A')) types.push('ORPHELIN_A');
  if (activeFilters.has('ORPHELIN_B')) types.push('ORPHELIN_B');
  p.set('types', types.join(','));   // '' si aucun chip → serveur renvoie 0 résultats

  if (activeRuleFilters !== null) {
    p.set('rules', [...activeRuleFilters].join(','));
    p.set('rule_logic', ruleFilterLogic);
  }
  if (filterText) p.set('q', filterText);
  if (sortCol)  { p.set('sort', sortCol); p.set('dir', sortDir === -1 ? 'desc' : 'asc'); }
  if (extraRefCols.length) p.set('extra_ref', extraRefCols.join(','));
  if (extraTgtCols.length) p.set('extra_tgt', extraTgtCols.join(','));

  try {
    const data = await fetch(`/api/results/${currentToken}?${p}`).then(r => r.json());
    if (data.error) { showErr(data.error); return; }
    _pageTot   = data.total;
    _pagePages = data.pages;
    _pageNum   = data.page;
    _syncExtraHeaders();
    _renderPage(data.results);
    _renderPagination();
  } catch(e) { showErr('Erreur pagination : ' + e.message); }
}

async function fetchMeta() {
  if (!currentToken) return;
  try {
    const meta = await fetch(`/api/results/${currentToken}/meta`).then(r => r.json());
    if (meta.error) return;
    _updateRuleChipCounts(meta.rule_counts || {});
    _renderColumnPicker(meta.ref_columns || [], meta.tgt_columns || []);
  } catch(_) {}
}

function _refresh() {
  if (currentToken) fetchPage(1);
  else              rebuildTable();
}

// ── Rendu d'une page de résultats ─────────────────────────
function _renderPage(rows) {
  const tbody = document.getElementById('tbody');
  const empty = document.getElementById('empty');
  tbody.innerHTML = '';
  if (!rows.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  rows.forEach(r => _appendPageRow(r));
}

const _EYE_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

function _appendPageRow(r) {
  const tbody = document.getElementById('tbody');
  const tr    = document.createElement('tr');

  // Badges pour chaque écart
  const badges = (r.ecarts || []).map(e => {
    if (e.type_ecart === 'PRESENT') return `<span class="badge badge-PRESENT">Présence OK</span>`;
    const isOrphan = e.type_ecart === 'ORPHELIN_A' || e.type_ecart === 'ORPHELIN_B';
    const dotColor = (!isOrphan && e.rule_name) ? ruleColor(e.rule_name) : null;
    const dot      = dotColor ? `<span class="rule-dot" style="background:${dotColor}"></span>` : '';
    const lbl      = isOrphan ? _typeLabel(e.type_ecart) : esc(e.rule_name || e.type_ecart);
    const title    = e.rule_name && !isOrphan
      ? `${esc(e.rule_name)} — réf: ${esc(e.valeur_reference)} / cible: ${esc(e.valeur_cible)}`
      : '';
    const dimmed   = (activeRuleFilters !== null && !isOrphan && e.rule_name && !activeRuleFilters.has(e.rule_name))
      ? ' dimmed' : '';
    const cls      = isOrphan ? `badge badge-${e.type_ecart}` : `rule-badge${dimmed}`;
    let style = '';
    if (!isOrphan && e.rule_name) {
      const rt = ruleType(e.rule_name);
      style = rt === 'coherence'
        ? ` style="background:var(--ok-bg);border-color:var(--ok-bd);color:var(--ok)"`
        : ` style="background:var(--oa-bg);border-color:var(--oa-bd);color:var(--oa)"`;
    }
    const dataRule = e.rule_name ? ` data-rule="${esc(e.rule_name)}"` : '';
    return `<button class="${cls}"${style}${dataRule} title="${title}">${dot}${lbl}</button>`;
  }).join('');

  let html = `<td class="td-eye"><button class="eye-btn" title="Voir le contexte">${_EYE_SVG}</button></td>`;
  const _kParts = (r.join_key || '').split('§');
  const _nKeys  = Math.max(1, (lastConfig?.join?.keys || []).length);
  for (let _ki = 0; _ki < _nKeys; _ki++) html += `<td class="tk">${esc(_kParts[_ki] ?? '')}</td>`;
  html    += `<td><div class="td-ecarts">${badges}</div></td>`;

  _extraColOrder.forEach(({side, col}) => {
    const v = (side === 'ref' ? r._ref : r._tgt)?.[col] ?? '';
    html += `<td class="tv xc xc-${side}" title="${esc(v)}">${esc(v)}</td>`;
  });

  tr.innerHTML = html;

  // Clic sur un badge de règle → filtrer sur cette règle
  tr.querySelectorAll('.rule-badge[data-rule]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); filterToRule(btn.dataset.rule); });
  });
  tr.querySelector('.eye-btn').addEventListener('click', () => openCtxModal(r.join_key, r.ecarts || []));
  tbody.appendChild(tr);
}

function _typeLabel(t) {
  if (t === 'ORPHELIN_A') return 'Absent cible';
  if (t === 'ORPHELIN_B') return 'Absent source';
  return t;
}

// ── En-têtes colonnes clé (dynamiques) ─────────────────────
function _rebuildKeyHeaders() {
  const tr = document.querySelector('#wfv-5 table thead tr');
  if (!tr) return;
  tr.querySelectorAll('.th-key').forEach(th => th.remove());
  const keys   = (lastConfig?.join?.keys || []);
  const labels = keys.length ? keys.map(k => k.source_field || 'Clé') : ['Clé'];
  const anchor = document.getElementById('th-rules');
  labels.forEach((label, i) => {
    const th = document.createElement('th');
    th.className = 'sortable th-key';
    th.setAttribute('onclick', `setSortCol('key_${i}')`);
    th.innerHTML = `${esc(label)}<span class="sort-ic" id="si-key-${i}">↕</span>`;
    tr.insertBefore(th, anchor);
  });
}

// ── En-têtes colonnes supplémentaires ─────────────────────
function _syncExtraHeaders() {
  const tr    = document.querySelector('#wfv-5 table thead tr');
  if (!tr) return;
  tr.querySelectorAll('.th-extra').forEach(th => th.remove());

  // Insérer avant th-fs (toujours dernier)
  const fsTh = document.getElementById('th-fs');

  const refFile = fileRef?.name || '';
  const tgtFile = fileTgt?.name || '';
  const refFmt  = (WS?.sources?.reference?.format || '').toUpperCase();
  const tgtFmt  = (WS?.sources?.target?.format    || '').toUpperCase();

  const mkTh = (side, col) => {
    const th = document.createElement('th');
    th.className = `th-extra th-extra-${side} sortable`;
    th.style.position = 'relative';
    const _thLbl = side === 'ref'
      ? (WS?.sources?.reference?.label || refLabel || 'Source A')
      : (WS?.sources?.target?.label    || tgtLabel || 'Source B');
    th.title = `${_thLbl} — ${col}`;
    th.dataset.xcside = side;
    th.dataset.xccol  = col;
    const file = side === 'ref' ? refFile : tgtFile;
    const fmt  = side === 'ref' ? refFmt  : tgtFmt;
    const meta = [file, fmt].filter(Boolean).join(' · ');
    const xcKey = `xc_${side}:${col}`;
    const isActive = sortCol === xcKey;
    const ic = isActive ? (sortDir === 1 ? '↑' : '↓') : '↕';
    th.innerHTML = `<div class="th-meta">${esc(meta)}</div><div class="th-field">${esc(col)}<span class="sort-ic">${ic}</span></div><div class="col-resize-handle"></div>`;
    if (isActive) th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
    th.addEventListener('click', e => { if (!e.target.classList.contains('col-resize-handle')) setSortCol(xcKey); });
    _addColResize(th);
    _addColDrag(th, side, col);
    tr.insertBefore(th, fsTh);
  };

  // Suivre l'ordre mixte; ajouter les colonnes sélectionnées absentes de _extraColOrder
  const inOrder = new Set(_extraColOrder.map(e => e.side + ':' + e.col));
  extraRefCols.forEach(c => { if (!inOrder.has('ref:' + c)) _extraColOrder.push({side:'ref', col:c}); });
  extraTgtCols.forEach(c => { if (!inOrder.has('tgt:' + c)) _extraColOrder.push({side:'tgt', col:c}); });
  // Purger les colonnes désélectionnées
  _extraColOrder = _extraColOrder.filter(e =>
    (e.side === 'ref' ? extraRefCols : extraTgtCols).includes(e.col)
  );

  _extraColOrder.forEach(({side, col}) => mkTh(side, col));
}

function _addColResize(th) {
  const handle = th.querySelector('.col-resize-handle');
  if (!handle) return;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.pageX;
    const startW = th.offsetWidth;
    const onMove = ev => { th.style.width = Math.max(60, startW + ev.pageX - startX) + 'px'; };
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function _addColDrag(th, side, col) {
  th.draggable = true;
  th.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', JSON.stringify({side, col}));
    th.classList.add('col-dragging');
  });
  th.addEventListener('dragend', () => th.classList.remove('col-dragging'));
  th.addEventListener('dragover', e => { e.preventDefault(); th.classList.add('col-drag-over'); });
  th.addEventListener('dragleave', () => th.classList.remove('col-drag-over'));
  th.addEventListener('drop', e => {
    e.preventDefault();
    th.classList.remove('col-drag-over');
    let parsed;
    try { parsed = JSON.parse(e.dataTransfer.getData('text/plain')); } catch(_) { return; }
    const {side: fromSide, col: fromCol} = parsed;
    if (fromSide === side && fromCol === col) return;
    // Réordonner _extraColOrder (cross-side autorisé)
    const fromIdx = _extraColOrder.findIndex(e => e.side === fromSide && e.col === fromCol);
    const toIdx   = _extraColOrder.findIndex(e => e.side === side   && e.col === col);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = _extraColOrder.splice(fromIdx, 1);
    _extraColOrder.splice(toIdx, 0, moved);
    _syncExtraHeaders();
    if (currentToken) fetchPage(_pageNum);
  });
}

// ── Plein écran résultats ──────────────────────────────────
function toggleResultsFS() {
  const isFs = document.body.classList.toggle('results-fs');
  const btn = document.querySelector('.th-fs-btn');
  if (btn) btn.title = isFs ? 'Quitter le plein écran' : 'Plein écran';
}

// ── Pagination controls ────────────────────────────────────
function _renderPagination() {
  const bar = document.getElementById('pagination-bar');
  if (!bar) return;
  if (!currentToken || _pagePages <= 1) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const from = ((_pageNum - 1) * _pageSize + 1).toLocaleString('fr-FR');
  const to   = Math.min(_pageNum * _pageSize, _pageTot).toLocaleString('fr-FR');
  const tot  = _pageTot.toLocaleString('fr-FR');
  const sizeSel = [50, 100, 200, 500, 1000, 2000].map(n =>
    `<option value="${n}"${n === _pageSize ? ' selected' : ''}>${n}</option>`).join('');
  const pageSel = Array.from({length: _pagePages}, (_, i) =>
    `<option value="${i+1}"${i+1 === _pageNum ? ' selected' : ''}>${i+1}</option>`).join('');
  bar.innerHTML = `
    <button class="btn-xs" ${_pageNum <= 1 ? 'disabled' : ''} onclick="fetchPage(${_pageNum-1})">← Préc.</button>
    <span class="pag-info">${from}–${to} / ${tot}</span>
    <select class="pag-sel" onchange="fetchPage(+this.value)">${pageSel}</select>
    <span class="pag-sep">|</span>
    <select class="pag-sel" onchange="_setPageSize(+this.value)" title="Lignes par page">${sizeSel} / page</select>
    <button class="btn-xs" ${_pageNum >= _pagePages ? 'disabled' : ''} onclick="fetchPage(${_pageNum+1})">Suiv. →</button>`;
}

function _setPageSize(n) { _pageSize = n; fetchPage(1); }

// ── Sélecteur de colonnes supplémentaires ─────────────────
function _renderColumnPicker(refCols, tgtCols) {
  const panel = document.getElementById('col-picker');
  if (!panel) return;
  if (!refCols.length && !tgtCols.length) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  const refLbl = esc(WS?.sources?.reference?.label || refLabel || 'Source A');
  const tgtLbl = esc(WS?.sources?.target?.label    || tgtLabel || 'Source B');

  const mkGroup = (label, cols, side) => {
    if (!cols.length) return '';
    const checks = cols.map(c => {
      const sel = (side === 'ref' ? extraRefCols : extraTgtCols).includes(c);
      return `<label class="col-pick-item col-pick-${side}">
        <input type="checkbox" ${sel ? 'checked' : ''} onchange="_toggleExtraCol('${side}','${esc(c)}',this.checked)">
        ${esc(c)}</label>`;
    }).join('');
    const color = side === 'ref' ? 'var(--ok)' : 'var(--ob)';
    return `<div class="col-pick-group"><span class="col-pick-lbl" style="color:${color}">${label}</span>${checks}</div>`;
  };

  document.getElementById('col-picker-body').innerHTML =
    mkGroup(refLbl, refCols, 'ref') + mkGroup(tgtLbl, tgtCols, 'tgt');
}

function _toggleExtraCol(side, col, checked) {
  if (side === 'ref') {
    if (checked) { if (!extraRefCols.includes(col)) extraRefCols.push(col); }
    else extraRefCols = extraRefCols.filter(c => c !== col);
  } else {
    if (checked) { if (!extraTgtCols.includes(col)) extraTgtCols.push(col); }
    else extraTgtCols = extraTgtCols.filter(c => c !== col);
  }
  _syncExtraHeaders();
  if (currentToken) fetchPage(_pageNum);
}


// ═══════════════════════════════════════════════════════════
//  HISTORIQUE — rendu local (allResults)
// ═══════════════════════════════════════════════════════════
function appendRow(r) {
  const _isOrphanA = r.type_ecart === 'ORPHELIN_A' || r.type_ecart === 'ORPHELIN_B';
  if (!activeFilters.has(_isOrphanA ? r.type_ecart : 'BOTH')) return;
  if (activeRuleFilters !== null && r.rule_name && !activeRuleFilters.has(r.rule_name)) return;
  if (!_rowMatchesText(r)) return;
  const tbody = document.getElementById('tbody');
  const tr    = document.createElement('tr');
  const _kPartsH = (r.join_key || '').split('§');
  const _nKeysH  = Math.max(1, (lastConfig?.join?.keys || []).length);
  let _keyHtml = '';
  for (let _ki = 0; _ki < _nKeysH; _ki++) _keyHtml += `<td class="tk">${esc(_kPartsH[_ki] ?? '')}</td>`;
  tr.innerHTML = `
    ${_keyHtml}
    <td><span class="badge badge-${r.type_ecart}">${r.type_ecart}</span></td>
    <td>${r.rule_name ? `<button class="rule-chip">${esc(r.rule_name)}</button>` : ''}</td>
    <td class="tv r" title="${esc(r.valeur_reference)}">${esc(r.valeur_reference)}</td>
    <td class="tv t" title="${esc(r.valeur_cible)}">${esc(r.valeur_cible)}</td>
    <td class="td-eye"><button class="eye-btn" title="Voir le contexte"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></td>`;
  const ruleBtn = tr.querySelector('.rule-chip');
  if (ruleBtn) {
    if (activeRuleFilters && activeRuleFilters.size === 1 && activeRuleFilters.has(r.rule_name))
      ruleBtn.classList.add('solo');
    ruleBtn.addEventListener('click', () => filterToRule(r.rule_name));
  }
  tr.querySelector('.eye-btn').addEventListener('click', () => openCtxModal(r.join_key));
  tbody.appendChild(tr);
}

function rebuildTable() {
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  const empty = document.getElementById('empty');

  let rows = allResults.filter(r => {
    const isOrphan = r.type_ecart === 'ORPHELIN_A' || r.type_ecart === 'ORPHELIN_B';
    if (!activeFilters.has(isOrphan ? r.type_ecart : 'BOTH')) return false;
    if (activeRuleFilters !== null && r.rule_name && !activeRuleFilters.has(r.rule_name)) return false;
    if (!_rowMatchesText(r)) return false;
    return true;
  });
  if (sortCol) {
    const _ki = sortCol.startsWith('key_') ? parseInt(sortCol.slice(4), 10) : -1;
    const field = _SORT_KEY[sortCol];
    rows = rows.slice().sort((a, b) => {
      let va, vb;
      if (_ki >= 0) {
        const pa = (a.join_key || '').split('§'); va = (pa[_ki] || '').toLowerCase();
        const pb = (b.join_key || '').split('§'); vb = (pb[_ki] || '').toLowerCase();
      } else {
        va = (a[field] || '').toString().toLowerCase();
        vb = (b[field] || '').toString().toLowerCase();
      }
      return va < vb ? -sortDir : va > vb ? sortDir : 0;
    });
  }
  if (!rows.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  rows.forEach(r => appendRow(r));
  // Pas de pagination pour l'historique (données déjà limitées côté serveur)
  const bar = document.getElementById('pagination-bar');
  if (bar) bar.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════
//  COMPTEURS
// ═══════════════════════════════════════════════════════════
function updateLiveCounts() {
  document.getElementById('c-oa').textContent = _liveOA;
  document.getElementById('c-ob').textContent = _liveOB;
}

function updateChipCounts() {
  const oa = lastSummary.orphelins_a || 0;
  const ob = lastSummary.orphelins_b || 0;
  document.getElementById('c-oa').textContent  = oa;
  document.getElementById('c-ob').textContent  = ob;
  // "Présence dans les deux" = clés avec au moins un résultat de règle (KO ou OK émis)
  const both = (lastSummary.divergents || 0) + (lastSummary.ok || 0);
  const bothEl = document.getElementById('c-both');
  if (bothEl) bothEl.textContent = both.toLocaleString('fr-FR');
}

function _updateRuleChipCounts(ruleCounts) {
  const rules = lastConfig?.rules || [];
  rules.forEach(rule => {
    const cnt = ruleCounts[rule.name] || 0;
    document.querySelectorAll(`#filter-dynamic .chip[data-t="${CSS.escape(rule.name)}"]`).forEach(btn => {
      const sp = btn.querySelector('.chip-c');
      if (sp) sp.textContent = cnt;
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  FILTER BAR
// ═══════════════════════════════════════════════════════════
function ruleTooltip(rule) {
  const OP_LABEL = { equals:'=', '=':'=', differs:'≠', '<>':'≠', greater:'>',  '>':'>',
                     less:'<', '<':'<', contains:'∋', not_contains:'∌' };
  const type  = rule.rule_type === 'incoherence' ? 'Incohérence' : 'Cohérence';
  const logic = rule.logic || 'AND';
  const fields = (rule.fields || []).map(f => {
    const op = OP_LABEL[f.operator] || f.operator || '=';
    if (f.source_data) {
      const src = f.source_data.field || '?';
      const tgt = f.target_data?.field || f.target_data?.value || '?';
      const tol = f.target_data?.tolerance ? ` ±${f.target_data.tolerance}` : '';
      return `  • ${src} ${op} ${tgt}${tol}`;
    }
    if (f.target_value !== undefined) return `  • ${f.source_field || '?'} ${op} "${f.target_value}"`;
    const src = f.source_field || '?';
    const tgt = f.target_field || '?';
    const tol = f.tolerance ? ` ±${f.tolerance}` : '';
    return `  • ${src} ${op} ${tgt}${tol}`;
  });
  return `${type} | ${logic}\n${fields.join('\n')}`;
}

function buildRuleFilterBar(summary, config) {
  const dyn   = document.getElementById('filter-dynamic');
  dyn.innerHTML = '';
  const rules = config?.rules || [];

  if (!rules.length) { activeRuleFilters = null; return; }
  activeRuleFilters = new Set(rules.map(r => r.name));

  const sep = document.createElement('div');
  sep.className = 'filter-sep';
  dyn.appendChild(sep);

  const grp = document.createElement('div');
  grp.className = 'filter-group';
  grp.innerHTML = '<span class="filter-group-label">Règles</span>';

  const logicBtn = document.createElement('button');
  logicBtn.id = 'rule-logic-btn';
  logicBtn.className = 'rule-logic-btn' + (ruleFilterLogic === 'AND' ? ' is-and' : '');
  logicBtn.textContent = ruleFilterLogic;
  logicBtn.title = 'AND : toutes les règles sélectionnées doivent correspondre\nOR : au moins une règle suffit';
  logicBtn.addEventListener('click', () => {
    ruleFilterLogic = ruleFilterLogic === 'OR' ? 'AND' : 'OR';
    logicBtn.textContent = ruleFilterLogic;
    logicBtn.classList.toggle('is-and', ruleFilterLogic === 'AND');
    _refresh();
  });
  grp.appendChild(logicBtn);

  rules.forEach((rule, idx) => {
    const dotColor = RULE_COLORS[idx % RULE_COLORS.length];
    const isCoh    = rule.rule_type === 'coherence';
    const btn      = document.createElement('button');
    btn.className      = 'chip on ' + (isCoh ? 'cr-coh' : 'cr-inc');
    btn.dataset.kind   = 'rule';
    btn.dataset.t      = rule.name;
    btn.title          = ruleTooltip(rule);
    btn.addEventListener('click', function() { toggleChip(this); });
    btn.innerHTML = `<span class="rule-dot" style="background:${dotColor}"></span>${esc(rule.name)} <span class="chip-c">…</span>`;
    grp.appendChild(btn);
  });
  dyn.appendChild(grp);

  // Mettre à jour les labels de présence avec les labels source/cible
  const rL = WS?.sources?.reference?.label || refLabel || 'Source';
  const tL = WS?.sources?.target?.label    || tgtLabel || 'Cible';
  const oaLbl = document.getElementById('chip-lbl-oa');
  const obLbl = document.getElementById('chip-lbl-ob');
  if (oaLbl) oaLbl.textContent = rL;
  if (obLbl) obLbl.textContent = tL;
}

// ═══════════════════════════════════════════════════════════
//  FILTRES & TRI
// ═══════════════════════════════════════════════════════════
function toggleChip(btn) {
  const kind = btn.dataset.kind || 'type';
  const t    = btn.dataset.t;
  const isOn = btn.classList.contains('on');
  btn.classList.toggle('on', !isOn);

  if (kind === 'type') {
    if (isOn) activeFilters.delete(t); else activeFilters.add(t);
  } else if (kind === 'rule') {
    if (!activeRuleFilters) activeRuleFilters = new Set((lastConfig?.rules || []).map(r => r.name));
    if (isOn) activeRuleFilters.delete(t); else activeRuleFilters.add(t);
  }
  _refresh();
}

function filterToRule(name) {
  const isSolo = activeRuleFilters && activeRuleFilters.size === 1 && activeRuleFilters.has(name);
  if (isSolo) {
    const rules = lastConfig?.rules || [];
    activeRuleFilters = rules.length ? new Set(rules.map(r => r.name)) : null;
  } else {
    activeRuleFilters = new Set([name]);
  }
  document.querySelectorAll('#filter-dynamic .chip[data-kind="rule"]').forEach(btn => {
    btn.classList.toggle('on', !activeRuleFilters || activeRuleFilters.has(btn.dataset.t));
  });
  _refresh();
}

function setFilterText(v) {
  filterText = v.trim().toLowerCase();
  _refresh();
}

function setSortCol(col) {
  if (sortCol === col) { sortDir = -sortDir; }
  else { sortCol = col; sortDir = 1; }
  // Réinitialiser tous les indicateurs de clé
  document.querySelectorAll('.th-key').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    const ic = th.querySelector('.sort-ic');
    if (ic) ic.textContent = '↕';
  });
  // Activer l'indicateur de la colonne clé sélectionnée
  if (col.startsWith('key_')) {
    const ic = document.getElementById(`si-key-${col.slice(4)}`);
    if (ic) {
      ic.textContent = sortDir === 1 ? '↑' : '↓';
      ic.parentElement.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
    }
  }
  // Indicateur type
  const siType = document.getElementById('si-type');
  if (siType) {
    siType.textContent = col === 'type_ecart' ? (sortDir === 1 ? '↑' : '↓') : '↕';
    siType.parentElement.classList.toggle('sort-asc',  col === 'type_ecart' && sortDir === 1);
    siType.parentElement.classList.toggle('sort-desc', col === 'type_ecart' && sortDir === -1);
  }
  // Indicateurs colonnes supplémentaires
  document.querySelectorAll('.th-extra').forEach(th => {
    const side = th.dataset.xcside, col2 = th.dataset.xccol;
    if (!side || !col2) return;
    const xcKey = `xc_${side}:${col2}`;
    const ic = th.querySelector('.sort-ic');
    th.classList.remove('sort-asc','sort-desc');
    if (ic) ic.textContent = xcKey === sortCol ? (sortDir === 1 ? '↑' : '↓') : '↕';
    if (xcKey === sortCol) th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
  });
  _refresh();
}

// Mapping colonne → champ (pour le tri des données historique plates)
const _SORT_KEY = { key:'join_key', type:'type_ecart', rule:'rule_name', ref:'valeur_reference', tgt:'valeur_cible' };

function _rowMatchesText(r) {
  if (!filterText) return true;
  if ((r.join_key || '').toLowerCase().includes(filterText)) return true;
  for (const e of (r.ecarts || [])) {
    if ((e.rule_name || '').toLowerCase().includes(filterText)) return true;
    if ((e.valeur_reference || '').toLowerCase().includes(filterText)) return true;
    if ((e.valeur_cible || '').toLowerCase().includes(filterText)) return true;
    if ((e.champ || '').toLowerCase().includes(filterText)) return true;
  }
  for (const c of extraRefCols) {
    if (String(r._ref?.[c] ?? '').toLowerCase().includes(filterText)) return true;
  }
  for (const c of extraTgtCols) {
    if (String(r._tgt?.[c] ?? '').toLowerCase().includes(filterText)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════
function _updateExportBadge(total, maxPreview) {
  const badge = document.getElementById('export-complete-badge');
  if (!badge) return;
  if (!total) { badge.style.display = 'none'; return; }
  const n = total.toLocaleString('fr-FR');
  if (total > maxPreview) {
    badge.textContent = `↓ export complet — ${n} résultats`;
    badge.classList.add('truncated');
    badge.title = `L'affichage est limité à ${maxPreview} lignes, mais les exports CSV/XLSX contiennent les ${n} résultats complets.`;
  } else {
    badge.textContent = `${n} résultats`;
    badge.classList.remove('truncated');
    badge.title = '';
  }
  badge.style.display = '';
}

function exportReport(fmt) {
  if (!currentToken) { exportHTMLDynamic(); return; }

  const p = new URLSearchParams({ token: currentToken, format: fmt });

  // Colonnes supplémentaires actuellement sélectionnées
  if (extraRefCols.length) p.set('extra_ref', extraRefCols.join(','));
  if (extraTgtCols.length) p.set('extra_tgt', extraTgtCols.join(','));

  if (fmt === 'html') {
    // Traduire activeFilters vers types serveur (BOTH → KO+OK+DIVERGENT+PRESENT)
    const types = [];
    if (activeFilters.has('BOTH'))       { types.push('KO', 'OK', 'DIVERGENT', 'PRESENT'); }
    if (activeFilters.has('ORPHELIN_A')) types.push('ORPHELIN_A');
    if (activeFilters.has('ORPHELIN_B')) types.push('ORPHELIN_B');
    if (types.length) p.set('types', types.join(','));
    if (activeRuleFilters !== null) p.set('rules', [...activeRuleFilters].join(','));
    if (ruleFilterLogic !== 'OR') p.set('rule_logic', ruleFilterLogic);
    if (filterText) p.set('q', filterText);
  }
  // CSV et XLSX : tous les résultats (pas de filtre), extra cols seulement

  if (fmt === 'xlsx') {
    const btn = document.getElementById('btn-xlsx');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="spin"></div> Génération…';
    setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 8000);
  }

  window.location.href = `/api/export?${p}`;
}

function _getVisibleRows() {
  // Pour l'export HTML historique (sans token) uniquement
  const rows = allResults.filter(r => {
    const _isOrphan = r.type_ecart === 'ORPHELIN_A' || r.type_ecart === 'ORPHELIN_B';
    if (!activeFilters.has(_isOrphan ? r.type_ecart : 'BOTH')) return false;
    if (activeRuleFilters !== null && r.rule_name && !activeRuleFilters.has(r.rule_name)) return false;
    if (!_rowMatchesText(r)) return false;
    return true;
  });
  if (!sortCol) return rows;
  const key = _SORT_KEY[sortCol];
  return rows.slice().sort((a, b) => {
    const va = (a[key] || '').toString().toLowerCase();
    const vb = (b[key] || '').toString().toLowerCase();
    return va < vb ? -sortDir : va > vb ? sortDir : 0;
  });
}

function exportHTMLDynamic() {
  const all      = allResults;
  const s        = lastSummary;
  const name     = lastConfig?.meta?.name || 'Audit';
  const rules    = lastConfig?.rules || [];
  const now      = new Date().toLocaleString('fr-FR');
  const esc2     = v => String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const cfgKeys  = (lastConfig?.join?.keys || []);
  const keyFields= cfgKeys.length ? cfgKeys.map(k => k.source_field || 'Clé') : ['Clé'];

  const ruleChips = rules.length
    ? `<div class="filter-sep"></div><span class="fl">Règles</span>` +
      rules.map(r => `<button class="chip cr on" data-k="rule" data-v="${esc2(r.name||'')}" onclick="toggleChip(this)">${esc2(r.name||'')} <span class="chip-c">0</span></button>`).join('')
    : '';

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Rapport \u2014 ${esc2(name)}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#f4f6f9;color:#2d3748}
.layout{display:flex;flex-direction:column;height:100vh;overflow:hidden}
header{padding:.75rem 1.5rem;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap;flex-shrink:0}
h1{font-size:1.15rem;font-weight:700}.meta{font-size:.72rem;color:#718096}
.cards{display:flex;gap:.6rem;flex-wrap:wrap;padding:.6rem 1.5rem;background:#fff;border-bottom:1px solid #e2e8f0;flex-shrink:0}
.card{background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:.4rem .85rem;text-align:center;min-width:80px}
.card .v{font-size:1.25rem;font-weight:700}.card .l{font-size:.62rem;color:#718096;margin-top:.1rem}
.ca .v{color:#e53e3e}.cb .v{color:#dd6b20}.cd .v{color:#d69e2e}.co .v{color:#276749}
.filter-bar{padding:.45rem 1rem;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;flex-wrap:wrap;gap:.3rem .45rem;align-items:center;flex-shrink:0}
.chip{background:none;border:1px solid #cbd5e0;color:#718096;font-size:.67rem;padding:.18rem .55rem;border-radius:99px;cursor:pointer;font-family:inherit;transition:all .15s}
.chip:hover{color:#2d3748;border-color:#4a5568}
.chip.on.ca{background:#fff5f5;border-color:#fc8181;color:#c53030}
.chip.on.cb{background:#fffaf0;border-color:#fbd38d;color:#c05621}
.chip.on.cd{background:#fffff0;border-color:#f6e05e;color:#b7791f}
.chip.on.co{background:#f0fff4;border-color:#9ae6b4;color:#276749}
.chip.on.cr{background:#ede9fe;border-color:#c4b5fd;color:#5b21b6}
.chip-c{background:rgba(0,0,0,.08);border-radius:99px;padding:0 .35rem;font-size:.58rem}
.fl{font-size:.63rem;color:#718096;margin-right:.1rem}
.filter-sep{width:1px;height:16px;background:#e2e8f0;margin:0 .2rem;flex-shrink:0;align-self:center}
.srch{border:1px solid #e2e8f0;border-radius:4px;padding:.22rem .55rem;font-size:.73rem;color:#2d3748;background:#f7fafc;outline:none;width:200px;margin-left:auto}
.srch:focus{border-color:#3b82f6}
.tbl-wrap{flex:1;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:.77rem;background:#fff}
thead th{background:#fff;padding:.48rem .8rem;text-align:left;font-size:.61rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#718096;border-bottom:1px solid #e2e8f0;position:sticky;top:0;cursor:pointer;user-select:none;white-space:nowrap}
thead th:hover{background:#f7fafc}
tbody tr{border-bottom:1px solid #f0f4f8}tbody tr:hover{background:#f7fafc}
td{padding:.42rem .8rem;vertical-align:middle}
.tk{font-family:monospace;font-size:.71rem;color:#4a5568;white-space:nowrap}
.tv{font-family:monospace;font-size:.71rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tv.r{color:#1d4ed8}.tv.t{color:#c05621}
.td-rule{font-size:.71rem;color:#7c3aed;font-family:monospace;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-det{font-size:.67rem;color:#718096;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{display:inline-block;padding:.13rem .45rem;border-radius:4px;font-size:.62rem;font-weight:700;font-family:monospace}
.badge-ORPHELIN_A{background:#fff5f5;color:#c53030;border:1px solid #fed7d7}
.badge-ORPHELIN_B{background:#fffaf0;color:#c05621;border:1px solid #feebc8}
.badge-KO,.badge-DIVERGENT{background:#fffff0;color:#b7791f;border:1px solid #fefcbf}
.badge-OK{background:#f0fff4;color:#276749;border:1px solid #c6f6d5}
.sort-ic{opacity:.22;margin-left:.2rem;font-size:.58rem}
th.sort-asc .sort-ic,th.sort-desc .sort-ic{opacity:1;color:#3b82f6}
.empty{text-align:center;padding:3rem;color:#a0aec0;font-style:italic;display:none}
</style></head><body><div class="layout">
<header><h1>\ud83d\udcc8 ${esc2(name)}</h1><span class="meta">G\xe9n\xe9r\xe9 le ${now}</span></header>
<div class="cards">
  <div class="card"><div class="v">${s.total_reference||0}</div><div class="l">R\xe9f.</div></div>
  <div class="card"><div class="v">${s.total_cible||0}</div><div class="l">Cible</div></div>
  <div class="card ca"><div class="v">${s.orphelins_a||0}</div><div class="l">Pas dans la cible</div></div>
  <div class="card cb"><div class="v">${s.orphelins_b||0}</div><div class="l">Pas dans la réf.</div></div>
  <div class="card cd"><div class="v">${s.divergents||0}</div><div class="l">KO</div></div>
  <div class="card co"><div class="v">${s.ok||0}</div><div class="l">OK</div></div>
</div>
<div class="filter-bar">
  <span class="fl">Types</span>
  <button class="chip ca on" data-k="type" data-v="ORPHELIN_A" onclick="toggleChip(this)">Pas dans la cible <span class="chip-c" id="cc-a">0</span></button>
  <button class="chip cb on" data-k="type" data-v="ORPHELIN_B" onclick="toggleChip(this)">Pas dans la réf. <span class="chip-c" id="cc-b">0</span></button>
  <button class="chip cd on" data-k="type" data-v="KO" onclick="toggleChip(this)">KO <span class="chip-c" id="cc-ko">0</span></button>
  <button class="chip co on" data-k="type" data-v="OK" onclick="toggleChip(this)">OK <span class="chip-c" id="cc-ok">0</span></button>
  ${ruleChips}
  <input class="srch" id="srch" type="search" placeholder="Cl\xe9, valeur r\xe9f., valeur cible\u2026" oninput="render()">
</div>
<div class="tbl-wrap"><table>
<thead><tr>
  ${keyFields.map((f,i)=>`<th onclick="sortBy('join_key')">${esc2(f)}<span class="sort-ic"${i===0?' id="si-key"':''}>\u2195</span></th>`).join('')}
  <th onclick="sortBy('type_ecart')">Type<span class="sort-ic" id="si-type">\u2195</span></th>
  <th onclick="sortBy('rule_name')">R\xe8gle<span class="sort-ic" id="si-rule">\u2195</span></th>
  <th onclick="sortBy('champ')">Champ<span class="sort-ic" id="si-champ">\u2195</span></th>
  <th onclick="sortBy('valeur_reference')">Valeur r\xe9f.<span class="sort-ic" id="si-ref">\u2195</span></th>
  <th onclick="sortBy('valeur_cible')">Valeur cible<span class="sort-ic" id="si-tgt">\u2195</span></th>
  <th onclick="sortBy('detail')">D\xe9tail<span class="sort-ic" id="si-det">\u2195</span></th>
</tr></thead>
<tbody id="tbody"></tbody>
</table><div class="empty" id="empty">Aucun r\xe9sultat.</div></div>
</div>
<script>
const ALL=${JSON.stringify(all)};
const KF=${JSON.stringify(keyFields)};
let aT=new Set(ALL.map(r=>r.type_ecart));
let aR=new Set(ALL.filter(r=>r.rule_name).map(r=>r.rule_name));
let sC=null,sD=1;
function initCounts(){
  const ct={},cr={};
  for(const r of ALL){ct[r.type_ecart]=(ct[r.type_ecart]||0)+1;if(r.rule_name)cr[r.rule_name]=(cr[r.rule_name]||0)+1;}
  const ids={ORPHELIN_A:'cc-a',ORPHELIN_B:'cc-b',KO:'cc-ko',OK:'cc-ok'};
  for(const[t,id]of Object.entries(ids)){const el=document.getElementById(id);if(el)el.textContent=ct[t]||0;}
  document.querySelectorAll('[data-k="rule"]').forEach(b=>{const sp=b.querySelector('span');if(sp)sp.textContent=cr[b.dataset.v]||0;});
}
function toggleChip(b){
  b.classList.toggle('on');
  const on=b.classList.contains('on');
  if(b.dataset.k==='type'){if(on)aT.add(b.dataset.v);else aT.delete(b.dataset.v);}
  else{if(on)aR.add(b.dataset.v);else aR.delete(b.dataset.v);}
  render();
}
function sortBy(col){
  if(sC===col)sD=-sD;else{sC=col;sD=1;}
  document.querySelectorAll('thead th').forEach(th=>th.classList.remove('sort-asc','sort-desc'));
  document.querySelectorAll('.sort-ic').forEach(ic=>ic.textContent='\u2195');
  const m={join_key:'si-key',type_ecart:'si-type',rule_name:'si-rule',champ:'si-champ',valeur_reference:'si-ref',valeur_cible:'si-tgt',detail:'si-det'};
  const ic=document.getElementById(m[col]);
  if(ic){ic.textContent=sD>0?'\u2191':'\u2193';ic.closest('th').classList.add(sD>0?'sort-asc':'sort-desc');}
  render();
}
function render(){
  const q=(document.getElementById('srch')?.value||'').toLowerCase();
  let rows=ALL.filter(r=>{
    if(!aT.has(r.type_ecart))return false;
    if(r.rule_name&&!aR.has(r.rule_name))return false;
    if(q&&![(r.join_key||''),(r.valeur_reference||''),(r.valeur_cible||'')].some(v=>v.toLowerCase().includes(q)))return false;
    return true;
  });
  if(sC)rows=[...rows].sort((a,b)=>String(a[sC]||'').localeCompare(String(b[sC]||''),'fr',{numeric:true})*sD);
  const esc=v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const tb=document.getElementById('tbody');
  const em=document.getElementById('empty');
  if(!rows.length){tb.innerHTML='';em.style.display='block';return;}
  em.style.display='none';
  tb.innerHTML=rows.map(r=>{const kp=(r.join_key||'').split('\u00a7');return'<tr>'+
    KF.map((f,i)=>'<td class="tk">'+esc(kp[i]||'')+'</td>').join('')+
    '<td><span class="badge badge-'+esc(r.type_ecart)+'">'+esc(r.type_ecart)+'</span></td>'+
    '<td class="td-rule">'+esc(r.rule_name)+'</td>'+
    '<td class="tv">'+esc(r.champ)+'</td>'+
    '<td class="tv r">'+esc(r.valeur_reference)+'</td>'+
    '<td class="tv t">'+esc(r.valeur_cible)+'</td>'+
    '<td class="td-det" title="'+esc(r.detail)+'">'+esc(r.detail)+'</td>'+
  '</tr>';}).join('');
}
initCounts();render();
<\/script></body></html>`;

  const blob = new Blob([html], {type:'text/html;charset=utf-8'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  const _ts = new Date().toISOString().replace(/[-T:]/g,'').slice(0,12);
  a.download = `rapport_${name.replace(/\s+/g,'_')}_${_ts}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.addEventListener('DOMContentLoaded', _rebuildKeyHeaders);
