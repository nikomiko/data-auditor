// ── Ajout d'une ligne au tableau ──────────────────────────
function appendRow(r) {
  // Orphelins filtrés par type ; KO/DIVERGENT filtrés uniquement par règle
  if (r.type_ecart === 'ORPHELIN_A' || r.type_ecart === 'ORPHELIN_B') {
    if (!activeFilters.has(r.type_ecart)) return;
  }
  if (activeRuleFilters !== null && r.rule_name && !activeRuleFilters.has(r.rule_name)) return;
  if (!_rowMatchesText(r)) return;
  const tbody = document.getElementById('tbody');
  const tr    = document.createElement('tr');
  tr.innerHTML = `
    <td class="tk">${esc(r.join_key)}</td>
    <td><span class="badge badge-${r.type_ecart}">${r.type_ecart}</span></td>
    <td>${r.rule_name ? `<button class="rule-chip">${esc(r.rule_name)}</button>` : ''}</td>
    <td class="tv r" title="${esc(r.valeur_reference)}">${esc(r.valeur_reference)}</td>
    <td class="tv t" title="${esc(r.valeur_cible)}">${esc(r.valeur_cible)}</td>
    <td class="td-eye"><button class="eye-btn" title="Voir le détail"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button></td>`;
  // Listeners via closure — évite le problème des guillemets dans les attributs onclick HTML
  const ruleBtn = tr.querySelector('.rule-chip');
  if (ruleBtn) {
    // Solo style : appliqué ici car rebuildTable() recrée les lignes après filterToRule()
    if (activeRuleFilters && activeRuleFilters.size === 1 && activeRuleFilters.has(r.rule_name))
      ruleBtn.classList.add('solo');
    ruleBtn.addEventListener('click', () => filterToRule(r.rule_name));
  }
  tr.querySelector('.eye-btn').addEventListener('click', () => openCtxModal(r.join_key));
  tbody.appendChild(tr);
}

function updateLiveCounts() {
  // Pendant le streaming, on n'a pas encore lastConfig.rules → on compte juste les orphelins
  let oa = 0, ob = 0;
  allResults.forEach(r => {
    if (r.type_ecart === 'ORPHELIN_A') oa++;
    else if (r.type_ecart === 'ORPHELIN_B') ob++;
  });
  document.getElementById('c-oa').textContent = oa;
  document.getElementById('c-ob').textContent = ob;
  // Counts cohérence/incohérence mis à jour par updateChipCounts après summary
}

function updateChipCounts() {
  const counts = { ORPHELIN_A:0, ORPHELIN_B:0 };
  const ruleTypeCounts = { coherence:0, incoherence:0 };
  const ruleTypeMap = {};
  (lastConfig?.rules || []).forEach(r => { ruleTypeMap[r.name] = r.rule_type || 'coherence'; });
  allResults.forEach(r => {
    if (r.type_ecart === 'ORPHELIN_A') counts.ORPHELIN_A++;
    else if (r.type_ecart === 'ORPHELIN_B') counts.ORPHELIN_B++;
    else if (r.rule_name) {
      // KO → incoherence ; OK → coherence (selon le nouveau modèle)
      const rt = ruleTypeMap[r.rule_name] || 'coherence';
      ruleTypeCounts[rt]++;
    }
  });
  document.getElementById('c-oa').textContent  = counts.ORPHELIN_A;
  document.getElementById('c-ob').textContent  = counts.ORPHELIN_B;
  document.getElementById('c-coh').textContent = ruleTypeCounts.coherence;
  document.getElementById('c-inc').textContent = ruleTypeCounts.incoherence;
}

function ruleTooltip(rule) {
  const OP_LABEL = { equals:'=', '=':'=', differs:'≠', '<>':'≠', greater:'>',  '>':'>',
                     less:'<', '<':'<', contains:'∋', not_contains:'∌' };
  const type  = rule.rule_type === 'incoherence' ? 'Incohérence' : 'Cohérence';
  const logic = rule.logic || 'AND';
  const fields = (rule.fields || []).map(f => {
    const op = OP_LABEL[f.operator] || f.operator || '=';
    // source_data / target_data form
    if (f.source_data) {
      const src = f.source_data.field || '?';
      const tgt = f.target_data?.field || f.target_data?.value || '?';
      const tol = f.target_data?.tolerance ? ` ±${f.target_data.tolerance}` : '';
      return `  • ${src} ${op} ${tgt}${tol}`;
    }
    // fixed target_value
    if (f.target_value !== undefined) {
      return `  • ${f.source_field || '?'} ${op} "${f.target_value}"`;
    }
    // standard source_field / target_field
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

  // Afficher / masquer les chips groupe cohérence / incohérence
  const hasCoh = rules.some(r => (r.rule_type || 'coherence') === 'coherence');
  const hasInc = rules.some(r => r.rule_type === 'incoherence');
  const showGroup = hasCoh || hasInc;
  document.getElementById('sep-ruletype').style.display  = showGroup ? '' : 'none';
  document.getElementById('grp-ruletype').style.display  = showGroup ? '' : 'none';
  document.getElementById('chip-coh').style.display      = hasCoh ? '' : 'none';
  document.getElementById('chip-inc').style.display      = hasInc ? '' : 'none';

  if (!rules.length) { activeRuleFilters = null; return; }

  activeRuleFilters = new Set(rules.map(r => r.name));

  if (!rules.length) return;
  const sep = document.createElement('div');
  sep.className = 'filter-sep';
  dyn.appendChild(sep);

  const grp = document.createElement('div');
  grp.className = 'filter-group';
  grp.innerHTML = '<span class="filter-group-label">Règles</span>';

  // Comptage par règle depuis allResults (rule_stats ne couvre que les KO)
  const ruleCounts = {};
  allResults.forEach(r => {
    if (r.rule_name) ruleCounts[r.rule_name] = (ruleCounts[r.rule_name] || 0) + 1;
  });

  rules.forEach(rule => {
    const ruleType = rule.rule_type || 'coherence';
    const cnt = ruleCounts[rule.name] || 0;
    const btn = document.createElement('button');
    btn.className = ruleType === 'incoherence' ? 'chip ca on' : 'chip co on';
    btn.dataset.kind     = 'rule';
    btn.dataset.t        = rule.name;
    btn.dataset.ruleType = ruleType;
    btn.title = ruleTooltip(rule);
    btn.addEventListener('click', function() { toggleChip(this); });
    btn.innerHTML = `${esc(rule.name)} <span class="chip-c">${cnt}</span>`;
    grp.appendChild(btn);
  });
  dyn.appendChild(grp);
}

// ═══════════════════════════════════════════════════════════
//  FILTERS
// ═══════════════════════════════════════════════════════════
function toggleChip(btn) {
  const kind = btn.dataset.kind || 'type';
  const t    = btn.dataset.t;
  const isOn = btn.classList.contains('on');
  btn.classList.toggle('on', !isOn);

  if (kind === 'type') {
    if (isOn) activeFilters.delete(t); else activeFilters.add(t);

  } else if (kind === 'ruletype') {
    // Active/désactive toutes les règles du type cohérence ou incohérence
    if (!activeRuleFilters) {
      activeRuleFilters = new Set((lastConfig?.rules || []).map(r => r.name));
    }
    (lastConfig?.rules || []).forEach(r => {
      if ((r.rule_type || 'coherence') === t) {
        if (isOn) activeRuleFilters.delete(r.name);
        else      activeRuleFilters.add(r.name);
      }
    });
    // Sync pills individuelles du même type
    document.querySelectorAll(`#filter-dynamic .chip[data-kind="rule"][data-rule-type="${t}"]`).forEach(p => {
      p.classList.toggle('on', !isOn);
    });

  } else if (kind === 'rule') {
    if (!activeRuleFilters) {
      activeRuleFilters = new Set((lastConfig?.rules || []).map(r => r.name));
    }
    if (isOn) activeRuleFilters.delete(t); else activeRuleFilters.add(t);
    // Sync chip groupe : on si au moins une règle du même type est active
    _syncRuletypeChips();
  }
  rebuildTable();
}

function _syncRuletypeChips() {
  ['coherence','incoherence'].forEach(rt => {
    const rulesOfType = (lastConfig?.rules || []).filter(r => (r.rule_type||'coherence') === rt).map(r => r.name);
    if (!rulesOfType.length) return;
    const anyOn = rulesOfType.some(n => !activeRuleFilters || activeRuleFilters.has(n));
    const chip = document.getElementById(rt === 'coherence' ? 'chip-coh' : 'chip-inc');
    if (chip) chip.classList.toggle('on', anyOn);
  });
}

function filterToRule(name) {
  // Solo : si déjà seule règle active → tout réactiver, sinon → isoler
  const isSolo = activeRuleFilters && activeRuleFilters.size === 1 && activeRuleFilters.has(name);
  if (isSolo) {
    const rules = lastConfig?.rules || [];
    activeRuleFilters = rules.length ? new Set(rules.map(r => r.name)) : null;
  } else {
    activeRuleFilters = new Set([name]);
  }
  // Sync visuels chips règles et chips groupe
  document.querySelectorAll('#filter-dynamic .chip[data-kind="rule"]').forEach(btn => {
    const on = !activeRuleFilters || activeRuleFilters.has(btn.dataset.t);
    btn.classList.toggle('on', on);
  });
  _syncRuletypeChips();
  // rebuildTable recrée les lignes — appendRow applique le style solo directement
  rebuildTable();
}

function setFilterText(v) {
  filterText = v.trim().toLowerCase();
  rebuildTable();
}

function setSortCol(col) {
  if (sortCol === col) { sortDir = -sortDir; }
  else { sortCol = col; sortDir = 1; }
  // Mise à jour visuelle des icônes
  ['key','type','rule','ref','tgt'].forEach(c => {
    const th = document.getElementById('si-' + c)?.parentElement;
    const ic = document.getElementById('si-' + c);
    if (!th || !ic) return;
    th.classList.remove('sort-asc','sort-desc');
    ic.textContent = '↕';
    if (c === sortCol) {
      th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
      ic.textContent = sortDir === 1 ? '↑' : '↓';
    }
  });
  rebuildTable();
}

const _SORT_KEY = { key:'join_key', type:'type_ecart', rule:'rule_name', ref:'valeur_reference', tgt:'valeur_cible' };

function _rowMatchesText(r) {
  if (!filterText) return true;
  return (r.join_key || '').toLowerCase().includes(filterText)
      || (r.valeur_reference || '').toLowerCase().includes(filterText)
      || (r.valeur_cible || '').toLowerCase().includes(filterText);
}

function rebuildTable() {
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  const max = lastConfig?.report?.max_diff_preview || 500;

  let rows = allResults.filter(r => {
    if ((r.type_ecart === 'ORPHELIN_A' || r.type_ecart === 'ORPHELIN_B') && !activeFilters.has(r.type_ecart)) return false;
    if (activeRuleFilters !== null && r.rule_name && !activeRuleFilters.has(r.rule_name)) return false;
    if (!_rowMatchesText(r)) return false;
    return true;
  });

  if (sortCol) {
    const key = _SORT_KEY[sortCol];
    rows = rows.slice().sort((a, b) => {
      const va = (a[key] || '').toString().toLowerCase();
      const vb = (b[key] || '').toString().toLowerCase();
      return va < vb ? -sortDir : va > vb ? sortDir : 0;
    });
  }

  rows.slice(0, max).forEach(r => appendRow(r));
}

// ═══════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════
function exportReport(fmt) {
  if (fmt === 'csv') {
    if (!currentToken) return;
    window.location.href = `/api/export?token=${currentToken}&format=csv`;
  } else if (fmt === 'xlsx') {
    if (!currentToken) return;
    window.location.href = `/api/export?token=${currentToken}&format=xlsx`;
  } else {
    exportHTMLDynamic();
  }
}

function _getVisibleRows() {
  // Reconstruit la liste visible (filtres + tri actuels) sans limite max
  const rows = allResults.filter(r => {
    if ((r.type_ecart === 'ORPHELIN_A' || r.type_ecart === 'ORPHELIN_B') && !activeFilters.has(r.type_ecart)) return false;
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
  const all   = allResults;
  const s     = lastSummary;
  const name  = lastConfig?.meta?.name || 'Audit';
  const rules = lastConfig?.rules || [];
  const now   = new Date().toLocaleString('fr-FR');
  const esc2  = v => String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

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
  <div class="card ca"><div class="v">${s.orphelins_a||0}</div><div class="l">Orphelins A</div></div>
  <div class="card cb"><div class="v">${s.orphelins_b||0}</div><div class="l">Orphelins B</div></div>
  <div class="card cd"><div class="v">${s.divergents||0}</div><div class="l">KO</div></div>
  <div class="card co"><div class="v">${s.ok||0}</div><div class="l">OK</div></div>
</div>
<div class="filter-bar">
  <span class="fl">Types</span>
  <button class="chip ca on" data-k="type" data-v="ORPHELIN_A" onclick="toggleChip(this)">Orphelin A <span class="chip-c" id="cc-a">0</span></button>
  <button class="chip cb on" data-k="type" data-v="ORPHELIN_B" onclick="toggleChip(this)">Orphelin B <span class="chip-c" id="cc-b">0</span></button>
  <button class="chip cd on" data-k="type" data-v="KO" onclick="toggleChip(this)">KO <span class="chip-c" id="cc-ko">0</span></button>
  <button class="chip co on" data-k="type" data-v="OK" onclick="toggleChip(this)">OK <span class="chip-c" id="cc-ok">0</span></button>
  ${ruleChips}
  <input class="srch" id="srch" type="search" placeholder="Cl\xe9, valeur r\xe9f., valeur cible\u2026" oninput="render()">
</div>
<div class="tbl-wrap"><table>
<thead><tr>
  <th onclick="sortBy('join_key')">Cl\xe9<span class="sort-ic" id="si-key">\u2195</span></th>
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
  tb.innerHTML=rows.map(r=>'<tr>'+
    '<td class="tk">'+esc(r.join_key)+'</td>'+
    '<td><span class="badge badge-'+esc(r.type_ecart)+'">'+esc(r.type_ecart)+'</span></td>'+
    '<td class="td-rule">'+esc(r.rule_name)+'</td>'+
    '<td class="tv">'+esc(r.champ)+'</td>'+
    '<td class="tv r">'+esc(r.valeur_reference)+'</td>'+
    '<td class="tv t">'+esc(r.valeur_cible)+'</td>'+
    '<td class="td-det" title="'+esc(r.detail)+'">'+esc(r.detail)+'</td>'+
  '</tr>').join('');
}
initCounts();render();
<\/script></body></html>`;

  const blob = new Blob([html], {type:'text/html;charset=utf-8'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `rapport_${name.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

