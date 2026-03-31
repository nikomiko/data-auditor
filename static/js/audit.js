// ═══════════════════════════════════════════════════════════
//  RUN AUDIT
// ═══════════════════════════════════════════════════════════
async function runAudit() {
  hideErr();
  // S'assurer que le YAML est à jour depuis le wizard
  _saveCurrentWFStep();
  document.getElementById('yaml').value = wizBuildYaml();
  const yamlText = document.getElementById('yaml').value.trim();
  if (!fileRef)  { showErr('Chargez le fichier de référence (Source A).'); return; }
  if (!fileTgt)  { showErr('Chargez le fichier cible (Source B).'); return; }
  if (!yamlText) { showErr('La configuration YAML est vide.'); return; }
  sessionSave();

  const RUN_BTN_HTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Lancer l\'audit';
  const btn = document.getElementById('gnav-run');
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div> Envoi…';

  document.getElementById('results-area').style.display = 'none';
  document.getElementById('trunc').style.display = 'none';
  allResults = [];
  _liveOA = 0; _liveOB = 0;
  filterText = ''; sortCol = null; sortDir = 1;
  // Réinitialiser les filtres pour chaque nouvel audit
  activeFilters = new Set(['BOTH']);
  activeRuleFilters = null;
  document.querySelectorAll('#filter-bar .chip[data-kind="type"]').forEach(btn => {
    const t = btn.dataset.t;
    btn.classList.toggle('on', activeFilters.has(t));
  });
  document.getElementById('filter-dynamic').innerHTML = '';
  const ftEl = document.getElementById('filter-text');
  if (ftEl) ftEl.value = '';
  ['key','type'].forEach(c => {
    const th = document.getElementById('si-' + c)?.parentElement;
    const ic = document.getElementById('si-' + c);
    if (th) { th.classList.remove('sort-asc','sort-desc'); }
    if (ic) ic.textContent = '↕';
  });
  document.getElementById('tbody').innerHTML = '';

  const fd = new FormData();
  fd.append('file_ref', fileRef);
  fd.append('file_tgt', fileTgt);
  fd.append('config_yaml', yamlText);
  fd.append('run_label', WS.meta.run_label || '');

  // Toujours basculer vers la page résultats (step 5) dès le lancement
  if (wfUnlocked < 5) wfUnlocked = 5;
  goWFStep(5);
  showProgress(true);
  updateProgress({ pct: 0, done: 0, total: 0, step: 'Envoi de la configuration…' });

  try {
    const resp = await fetch('/api/audit', { method: 'POST', body: fd });
    const data = await resp.json();
    if (!resp.ok || data.error) {
      showErr(data.error || 'Erreur serveur.');
      showProgress(false);
      btn.innerHTML = RUN_BTN_HTML;
      btn.disabled = false;
      return;
    }

    currentToken = data.token;
    updateProgress({ pct: 0, done: 0, total: 0, step: 'Démarrage…' });

    // Afficher le tableau de suite (rempli au fil des events)
    document.getElementById('results-area').style.display = 'flex';
    document.getElementById('btn-csv').disabled  = true;
    document.getElementById('btn-html').disabled = true;
    document.getElementById('btn-xlsx').disabled = true;
    document.getElementById('btn-cli').disabled  = true;

    listenSSE(currentToken);

    btn.innerHTML = RUN_BTN_HTML;
    btn.disabled = false;

  } catch(e) {
    showErr('Erreur réseau : ' + e.message);
    showProgress(false);
    btn.innerHTML = RUN_BTN_HTML;
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
//  SSE LISTENER
// ═══════════════════════════════════════════════════════════
function listenSSE(token) {
  const es = new EventSource(`/api/stream/${token}`);
  let   config = null;

  try { config = jsyaml.load(document.getElementById('yaml').value); } catch(_) {}

  es.onmessage = function(e) {
    const ev = JSON.parse(e.data);

    if (ev.event === 'progress') {
      updateProgress(ev);

    } else if (ev.event === 'filter_counts') {
      // Mise à jour partielle pendant le streaming
      const rL = WS?.sources?.reference?.label || refLabel || 'Source';
      const tL = WS?.sources?.target?.label    || tgtLabel || 'Cible';
      document.getElementById('sum-src').textContent = `${rL} : ${ev.ref_count.toLocaleString('fr-FR')} enr.`;
      document.getElementById('sum-tgt').textContent = `${tL} : ${ev.tgt_count.toLocaleString('fr-FR')} enr.`;

    } else if (ev.event === 'result') {
      if (ev.type_ecart === 'ORPHELIN_A') _liveOA++;
      else if (ev.type_ecart === 'ORPHELIN_B') _liveOB++;
      updateLiveCounts();

    } else if (ev.event === 'summary') {
      lastSummary = ev;
      lastConfig  = config || {};
      _rebuildKeyHeaders();
      const rL = WS?.sources?.reference?.label || refLabel || 'Source';
      const tL = WS?.sources?.target?.label    || tgtLabel || 'Cible';
      const oa = (ev.orphelins_a || 0).toLocaleString('fr-FR');
      const ob = (ev.orphelins_b || 0).toLocaleString('fr-FR');
      const tr = (ev.total_reference || 0).toLocaleString('fr-FR');
      const tc = (ev.total_cible     || 0).toLocaleString('fr-FR');
      document.getElementById('sum-src').textContent =
        `${rL} : ${tr} enr. dont ${oa} absents de la cible`;
      document.getElementById('sum-tgt').textContent =
        `${tL} : ${tc} enr. dont ${ob} absents de la source`;
      updateChipCounts();
      buildRuleFilterBar(ev, config);
      updateOrphelinLabels(config);

    } else if (ev.event === 'done') {
      updateProgress({ pct: 100, done: ev.total_results, total: ev.total_results,
                       step: `Terminé — ${ev.total_results.toLocaleString('fr-FR')} résultats` });
      document.getElementById('prog-bar').classList.remove('indeterminate');
      document.getElementById('prog-bar').style.width = '100%';

      // Charger la première page depuis le serveur
      fetchPage(1);
      fetchMeta();

      // Activer exports + badge "export complet"
      document.getElementById('btn-csv').disabled  = false;
      document.getElementById('btn-html').disabled = false;
      document.getElementById('btn-xlsx').disabled = false;
      document.getElementById('btn-cli').disabled  = false;
      _updateExportBadge(ev.total_results, config?.report?.max_diff_preview || 500);

      // Débloquer l'étape résultats
      wfUnlocked = 5;
      updateWFSteps();

      // Avertissement si troncature
      const max = config?.report?.max_diff_preview || 500;
      if (ev.total_results > max) {
        const t = document.getElementById('trunc');
        t.style.display = 'block';
        t.textContent = `Affichage limité à ${allResults.length} lignes sur ${ev.total_results.toLocaleString('fr-FR')}. Exportez pour la liste complète.`;
      }
      es.close();

    } else if (ev.event === 'error') {
      showErr(ev.message);
      showProgress(false);
      document.getElementById('gnav-run').disabled = false;
      document.getElementById('gnav-run').innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Lancer l\'audit';
      es.close();
    }
  };

  es.onerror = function() {
    es.close();
  };
}

// ═══════════════════════════════════════════════════════════
//  CONFIG VALIDATION  (/api/validate)
// ═══════════════════════════════════════════════════════════
function closeValidateModal(e) {
  if (e && e.target !== document.getElementById('validate-modal')) return;
  document.getElementById('validate-modal').style.display = 'none';
}

async function validateConfig() {
  _saveCurrentWFStep();
  const yamlText = wizBuildYaml();
  if (!yamlText.trim()) { showErr('La configuration YAML est vide.'); return; }

  const btn = document.getElementById('gnav-validate');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div>';

  try {
    const fd = new FormData();
    fd.append('config_yaml', yamlText);
    if (fileRef) fd.append('file_ref', fileRef);
    if (fileTgt) fd.append('file_tgt', fileTgt);

    const data = await fetch('/api/validate', { method: 'POST', body: fd }).then(r => r.json());

    const modal  = document.getElementById('validate-modal');
    const title  = document.getElementById('validate-modal-title');
    const body   = document.getElementById('validate-modal-body');

    if (data.valid) {
      title.textContent = '✓ Configuration valide';
      title.style.color = 'var(--ok)';
      body.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Aucune erreur détectée. Vous pouvez lancer l\'audit.</p>';
    } else {
      const errors = data.errors || ['Erreur inconnue.'];
      title.textContent = `⚠ ${errors.length} problème${errors.length > 1 ? 's' : ''} détecté${errors.length > 1 ? 's' : ''}`;
      title.style.color = 'var(--dv)';
      body.innerHTML = '<ol class="validate-error-list">' +
        errors.map(e => `<li>${esc(e)}</li>`).join('') + '</ol>';
    }
    modal.style.display = 'flex';
  } catch(e) {
    showErr('Impossible de contacter le serveur.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

// ═══════════════════════════════════════════════════════════
//  HISTORY — DELTA SELECTION
// ═══════════════════════════════════════════════════════════
let _deltaSelected = new Set();

function _toggleDeltaSel(filename, cb) {
  if (cb.checked) _deltaSelected.add(filename);
  else            _deltaSelected.delete(filename);
  _updateDeltaBar();
}

function _updateDeltaBar() {
  const bar  = document.getElementById('hist-delta-bar');
  const info = document.getElementById('hist-delta-info');
  const btn  = document.getElementById('hist-delta-btn');
  if (!bar) return;
  const n = _deltaSelected.size;
  if (n === 0) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  if (n === 1) {
    info.textContent = 'Sélectionnez un deuxième audit à comparer';
    btn.disabled = true;
  } else if (n === 2) {
    info.textContent = '2 audits sélectionnés';
    btn.disabled = false;
  } else {
    info.textContent = `${n} audits sélectionnés (max 2)`;
    btn.disabled = true;
  }
}

function clearDeltaSelection() {
  _deltaSelected.clear();
  document.querySelectorAll('.hist-chk').forEach(cb => { cb.checked = false; });
  _updateDeltaBar();
  document.getElementById('hist-delta-panel').style.display = 'none';
}

async function showDelta() {
  const [fa, fb] = [..._deltaSelected];
  const panel = document.getElementById('hist-delta-panel');
  panel.style.display = '';
  panel.innerHTML = '<div style="padding:1.5rem;color:var(--muted)">Calcul du delta…</div>';
  try {
    const p = new URLSearchParams({ a: fa, b: fb });
    const data = await fetch(`/api/history/delta?${p}`).then(r => r.json());
    if (data.error) { panel.innerHTML = `<div class="hist-empty">⚠ ${esc(data.error)}</div>`; return; }
    const _fmtMeta = m => `${fmtTs(m.timestamp || '')}${m.audit_name ? ' · ' + esc(m.audit_name) : ''}${m.run_label ? ' · ' + esc(m.run_label) : ''}`;
    const _row = r => `<div class="delta-row ${r.type_ecart==='ORPHELIN_A'?'oa':r.type_ecart==='ORPHELIN_B'?'ob':'ko'}">
      <span class="delta-key">${esc(r.join_key)}</span>
      <span class="delta-type">${esc(r.type_ecart)}</span>
      ${r.rule_name ? `<span class="delta-rule">${esc(r.rule_name)}</span>` : ''}
    </div>`;
    const _section = (title, cls, rows) => rows.length ? `
      <div class="delta-section">
        <div class="delta-section-title ${cls}">${title} (${rows.length})</div>
        ${rows.map(_row).join('')}
      </div>` : '';
    panel.innerHTML = `
      <div class="delta-header">
        <div class="delta-run"><span class="delta-run-lbl">A (ancien)</span>${_fmtMeta(data.meta_a)}</div>
        <div class="delta-run"><span class="delta-run-lbl">B (nouveau)</span>${_fmtMeta(data.meta_b)}</div>
      </div>
      ${_section('⬆ Apparus', 'delta-apparus', data.apparus)}
      ${_section('✓ Résolus',  'delta-resolus',  data.resolus)}
      ${_section('⚠ Persistants', 'delta-persistants', data.persistants)}
      ${!data.apparus.length && !data.resolus.length && !data.persistants.length
        ? '<div class="hist-empty">Aucun écart dans les deux runs.</div>' : ''}
    `;
  } catch(e) { panel.innerHTML = `<div class="hist-empty">Erreur : ${esc(e.message)}</div>`; }
}

// ═══════════════════════════════════════════════════════════
//  HISTORY
// ═══════════════════════════════════════════════════════════
async function loadHistory() {
  _deltaSelected.clear();
  const c = document.getElementById('history-list');
  c.innerHTML = '<div class="hist-empty">Chargement…</div>';
  try {
    const data = await fetch('/api/history').then(r => r.json());
    if (!data.length) { c.innerHTML = '<div class="hist-empty">Aucun audit historisé.</div>'; return; }
    const items = data.map(h => {
      const dur = h.duration_s != null ? `${h.duration_s}s` : '';
      const tot = h.total_results != null ? `${h.total_results.toLocaleString('fr-FR')} résultats` : '';
      const runLbl = h.run_label ? `<span class="hist-run-label">${esc(h.run_label)}</span>` : '';
      const meta = [dur, tot].filter(Boolean).join(' · ');
      return `
      <div class="hist-item">
        <label class="hist-chk-wrap" title="Sélectionner pour comparer">
          <input type="checkbox" class="hist-chk" onchange="_toggleDeltaSel('${esc(h.filename)}',this)" onclick="event.stopPropagation()">
        </label>
        <div class="hist-main" onclick="loadHistoryEntry('${esc(h.filename)}')">
          <div class="hist-header">
            <span class="hist-ts">${fmtTs(h.timestamp)}</span>
            ${runLbl}
          </div>
          <span class="hist-name">${esc(h.audit_name)}</span>
          <div class="hist-stats">
            <span class="hs a">A:${h.summary.orphelins_a||0}</span>
            <span class="hs b">B:${h.summary.orphelins_b||0}</span>
            <span class="hs d">Δ:${h.summary.divergents||0}</span>
            ${meta ? `<span class="hs meta">${esc(meta)}</span>` : ''}
          </div>
        </div>
        <div class="hist-actions">
          <button class="hist-replay" title="Relancer cet audit avec de nouveaux fichiers" onclick="replayAudit(event,'${esc(h.filename)}')">↺ Relancer</button>
          <button class="hist-del" title="Supprimer" onclick="deleteHistoryEntry(event,'${esc(h.filename)}')">🗑</button>
        </div>
      </div>`;
    }).join('');
    const purgeBtn = `<div class="hist-purge-bar"><button class="btn-xs btn-danger" onclick="purgeAllHistory()">🗑 Tout supprimer</button></div>`;
    c.innerHTML = purgeBtn + items;
  } catch(e) { c.innerHTML = '<div class="hist-empty">Erreur de chargement.</div>'; }
}

async function deleteHistoryEntry(ev, filename) {
  ev.stopPropagation();
  if (!confirm(`Supprimer cet audit ?`)) return;
  await fetch(`/api/history/${encodeURIComponent(filename)}`, {method:'DELETE'});
  loadHistory();
}

async function purgeAllHistory() {
  if (!confirm('Supprimer tout l\'historique ?')) return;
  await fetch('/api/history', {method:'DELETE'});
  loadHistory();
}

async function loadHistoryEntry(filename) {
  try {
    const data = await fetch(`/api/history/${filename}`).then(r => r.json());
    wfUnlocked = 5;
    goWFStep(5);
    allResults  = data.results || [];
    lastSummary = data.summary || {};
    lastConfig  = data.config  || {};
    _rebuildKeyHeaders();
    currentToken = null;

    const rLH = WS?.sources?.reference?.label || refLabel || 'Source';
    const tLH = WS?.sources?.target?.label    || tgtLabel || 'Cible';
    const oaH = (lastSummary.orphelins_a || 0).toLocaleString('fr-FR');
    const obH = (lastSummary.orphelins_b || 0).toLocaleString('fr-FR');
    const trH = (lastSummary.total_reference || 0).toLocaleString('fr-FR');
    const tcH = (lastSummary.total_cible     || 0).toLocaleString('fr-FR');
    document.getElementById('sum-src').textContent =
      `${rLH} : ${trH} enr. dont ${oaH} absents de la cible`;
    document.getElementById('sum-tgt').textContent =
      `${tLH} : ${tcH} enr. dont ${obH} absents de la source`;
    updateChipCounts();
    rebuildTable();
    showProgress(false);
    document.getElementById('results-area').style.display  = 'flex';
    const cp = document.getElementById('col-picker');
    if (cp) cp.style.display = 'none';
    const pb = document.getElementById('pagination-bar');
    if (pb) pb.style.display = 'none';
    document.getElementById('btn-csv').disabled  = true;
    document.getElementById('btn-html').disabled = false;
    document.getElementById('btn-xlsx').disabled = true;
    document.getElementById('btn-cli').disabled  = true;

    if (data.truncated) {
      const t = document.getElementById('trunc');
      t.style.display  = 'block';
      t.textContent    = `Affichage limité à ${allResults.length} lignes sur ${data.total_results}.`;
    }
  } catch(e) { showErr('Impossible de charger l\'audit : ' + e.message); }
}

async function replayAudit(ev, filename) {
  ev.stopPropagation();
  try {
    const data   = await fetch(`/api/history/${encodeURIComponent(filename)}`).then(r => r.json());
    const config = data.config;
    if (!config) { showErr('Config introuvable dans cet audit.'); return; }

    // Sérialiser le config dict en YAML
    const yamlText = jsyaml.dump(config, { indent: 2, lineWidth: -1 });
    applyYamlContent(yamlText, 'config.yaml');

    // Réinitialiser fichiers et résultats, aller à l'étape ①
    fileRef = null; fileTgt = null;
    allResults = []; lastSummary = {}; currentToken = null;
    wfUnlocked = 1;
    goWFStep(1);
    showErr('Configuration restaurée depuis l\'historique. Chargez les fichiers source et cible pour relancer l\'audit.');
  } catch(e) { showErr('Erreur lors du rechargement : ' + e.message); }
}

